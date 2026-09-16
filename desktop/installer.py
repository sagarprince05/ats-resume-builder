"""
ATS Resume Builder - single-file Windows installer.

Wraps the application executable and installs it for the current user:
no administrator rights, no dependencies, nothing to unzip. The same
executable also uninstalls when run with --uninstall, which is what the
Apps & features entry calls.

Standard library only, so it packages cleanly with PyInstaller.
"""
import os
import shutil
import subprocess
import sys
import time
import tkinter as tk
import winreg
from tkinter import messagebox, ttk

APP_NAME = "ATS Resume Builder"
APP_EXE = APP_NAME + ".exe"
UNINSTALLER = "Uninstall " + APP_NAME + ".exe"
REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ATSResumeBuilder"
VERSION = "1.0.0"
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW, keeps console flashes away


def install_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Programs", APP_NAME)


def payload_path():
    """The bundled application executable inside this installer."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    for candidate in (os.path.join(base, "payload", APP_EXE), os.path.join(base, APP_EXE)):
        if os.path.isfile(candidate):
            return candidate
    # Running from source: fall back to the dist build.
    local = os.path.abspath(os.path.join(base, "..", "dist", APP_EXE))
    return local if os.path.isfile(local) else None


def run_ps(script):
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            creationflags=NO_WINDOW, timeout=30,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def make_shortcut(lnk_path, target, workdir, description):
    ps = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(%s); "
        "$s.TargetPath = %s; $s.WorkingDirectory = %s; $s.IconLocation = %s; "
        "$s.Description = %s; $s.Save()"
    ) % (ps_str(lnk_path), ps_str(target), ps_str(workdir), ps_str(target + ",0"), ps_str(description))
    return run_ps(ps)


def ps_str(value):
    """Quote a string for PowerShell single-quoted literal syntax."""
    return "'" + str(value).replace("'", "''") + "'"


def shell_folder(name):
    """Start Menu programs folder or Desktop, via the shell so it works with OneDrive redirection."""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "[Environment]::GetFolderPath('%s')" % name],
            creationflags=NO_WINDOW, capture_output=True, text=True, timeout=20,
        )
        path = (out.stdout or "").strip()
        if path and os.path.isdir(path):
            return path
    except Exception:
        pass
    home = os.path.expanduser("~")
    if name == "Desktop":
        return os.path.join(home, "Desktop")
    return os.path.join(os.environ.get("APPDATA", home), r"Microsoft\Windows\Start Menu\Programs")


def stop_running_app():
    subprocess.run(["taskkill", "/F", "/IM", APP_EXE], creationflags=NO_WINDOW,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def browser_present():
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    local = os.environ.get("LOCALAPPDATA", "")
    for p in (
        os.path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    ):
        if os.path.isfile(p):
            return True
    return False


# ---------------------------------------------------------------- install
def do_install(desktop_shortcut, start_menu_shortcut, progress):
    src = payload_path()
    if not src:
        raise RuntimeError("This installer is missing its application file. Download it again.")

    dest = install_dir()
    progress("Closing any running copy…")
    stop_running_app()

    progress("Copying files…")
    os.makedirs(dest, exist_ok=True)
    target = os.path.join(dest, APP_EXE)
    with open(src, "rb") as fsrc, open(target, "wb") as fdst:
        while True:
            chunk = fsrc.read(1024 * 1024)
            if not chunk:
                break
            fdst.write(chunk)

    # Keep a copy of this installer so it can uninstall later.
    uninst = os.path.join(dest, UNINSTALLER)
    try:
        if getattr(sys, "frozen", False):
            with open(sys.executable, "rb") as fsrc, open(uninst, "wb") as fdst:
                fdst.write(fsrc.read())
    except Exception:
        uninst = ""

    progress("Creating shortcuts…")
    desc = "Build an ATS-friendly resume and tailor it to a job description"
    if start_menu_shortcut:
        make_shortcut(os.path.join(shell_folder("Programs"), APP_NAME + ".lnk"), target, dest, desc)
    if desktop_shortcut:
        make_shortcut(os.path.join(shell_folder("Desktop"), APP_NAME + ".lnk"), target, dest, desc)

    progress("Registering…")
    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_KEY) as k:
            winreg.SetValueEx(k, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(k, "DisplayIcon", 0, winreg.REG_SZ, target)
            winreg.SetValueEx(k, "DisplayVersion", 0, winreg.REG_SZ, VERSION)
            winreg.SetValueEx(k, "Publisher", 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(k, "InstallLocation", 0, winreg.REG_SZ, dest)
            winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)
            if uninst:
                winreg.SetValueEx(k, "UninstallString", 0, winreg.REG_SZ, '"%s" --uninstall' % uninst)
    except OSError:
        pass  # shortcuts still work without the Apps & features entry

    return target


# -------------------------------------------------------------- uninstall
def relaunch_from_temp(silent):
    """The uninstaller lives inside the folder it must delete, which keeps that
    file locked. Copy ourselves to TEMP and continue from there, so the whole
    folder can be removed in one go."""
    if not getattr(sys, "frozen", False):
        return False
    me = os.path.abspath(sys.executable)
    if os.path.dirname(me).lower() != install_dir().lower():
        return False    # already running from somewhere else
    tmp = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")),
                       "ats-resume-builder-uninstall.exe")
    try:
        with open(me, "rb") as fsrc, open(tmp, "wb") as fdst:
            fdst.write(fsrc.read())
    except OSError:
        return False    # fall back to deleting what we can from here
    args = [tmp, "--uninstall", "--relaunched"] + (["--silent"] if silent else [])
    try:
        subprocess.Popen(args, close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    return True


def do_uninstall(silent=False):
    # Hand over to a temp copy on the first run so nothing is locked.
    if "--relaunched" not in sys.argv and relaunch_from_temp(silent):
        return
    if not silent:
        root = tk.Tk()
        root.withdraw()
        if not messagebox.askyesno(APP_NAME, "Remove %s from this PC?\n\nResumes you saved in the app stay on this computer." % APP_NAME):
            return
    stop_running_app()
    for folder in ("Programs", "Desktop"):
        try:
            os.remove(os.path.join(shell_folder(folder), APP_NAME + ".lnk"))
        except OSError:
            pass
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, REG_KEY)
    except OSError:
        pass
    # Running from TEMP now, so the install folder can simply be deleted.
    dest = install_dir()
    for attempt in range(10):
        if not os.path.isdir(dest):
            break
        shutil.rmtree(dest, ignore_errors=True)
        if os.path.isdir(dest):
            time.sleep(1)   # the app or a shell window may still hold a handle

    if not silent:
        messagebox.showinfo(APP_NAME, "%s has been removed." % APP_NAME)


# -------------------------------------------------------------------- GUI
class Installer(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME + " Setup")
        self.resizable(False, False)
        self.configure(bg="#ffffff")
        self.installed_path = None

        try:
            self.tk.call("tk", "scaling", 1.3)
        except Exception:
            pass

        wrap = tk.Frame(self, bg="#ffffff", padx=28, pady=24)
        wrap.pack(fill="both", expand=True)

        tk.Label(wrap, text=APP_NAME, bg="#ffffff", fg="#16192a",
                 font=("Segoe UI", 16, "bold")).pack(anchor="w")
        tk.Label(wrap, text="Upload your CV, paste a job description, download a tailored resume.",
                 bg="#ffffff", fg="#6b7185", font=("Segoe UI", 9), justify="left").pack(anchor="w", pady=(4, 16))

        tk.Label(wrap, text="Installs to", bg="#ffffff", fg="#6b7185",
                 font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(wrap, text=install_dir(), bg="#f7f8fb", fg="#16192a", font=("Segoe UI", 8),
                 anchor="w", padx=9, pady=7, relief="flat").pack(fill="x", pady=(3, 14))

        self.want_desktop = tk.BooleanVar(value=True)
        self.want_start = tk.BooleanVar(value=True)
        tk.Checkbutton(wrap, text="Create a Desktop shortcut", variable=self.want_desktop,
                       bg="#ffffff", fg="#16192a", font=("Segoe UI", 9), activebackground="#ffffff",
                       selectcolor="#ffffff", anchor="w").pack(fill="x")
        tk.Checkbutton(wrap, text="Add to the Start Menu", variable=self.want_start,
                       bg="#ffffff", fg="#16192a", font=("Segoe UI", 9), activebackground="#ffffff",
                       selectcolor="#ffffff", anchor="w").pack(fill="x", pady=(0, 14))

        self.status = tk.Label(wrap, text="No administrator rights needed.", bg="#ffffff",
                               fg="#6b7185", font=("Segoe UI", 8), anchor="w")
        self.status.pack(fill="x", pady=(0, 10))

        row = tk.Frame(wrap, bg="#ffffff")
        row.pack(fill="x")
        self.cancel_btn = ttk.Button(row, text="Cancel", command=self.destroy)
        self.cancel_btn.pack(side="right")
        self.action_btn = ttk.Button(row, text="Install", command=self.on_install)
        self.action_btn.pack(side="right", padx=(0, 8))

        if not browser_present():
            self.status.configure(
                text="Microsoft Edge or Google Chrome is required to run the app.", fg="#dc4c4c")

        self.update_idletasks()
        w, h = self.winfo_width(), self.winfo_height()
        self.geometry("+%d+%d" % ((self.winfo_screenwidth() - w) // 2,
                                  (self.winfo_screenheight() - h) // 3))

    def set_status(self, text, colour="#6b7185"):
        self.status.configure(text=text, fg=colour)
        self.update_idletasks()

    def on_install(self):
        self.action_btn.configure(state="disabled")
        self.cancel_btn.configure(state="disabled")
        try:
            self.installed_path = do_install(
                self.want_desktop.get(), self.want_start.get(), self.set_status)
        except Exception as exc:
            self.set_status("Install failed: %s" % exc, "#dc4c4c")
            self.action_btn.configure(state="normal", text="Try again")
            self.cancel_btn.configure(state="normal")
            return
        self.set_status("Installed. You can open it from the Start Menu any time.", "#17935a")
        self.action_btn.configure(text="Open now", state="normal", command=self.launch)
        self.cancel_btn.configure(text="Close", state="normal")

    def launch(self):
        if self.installed_path:
            try:
                subprocess.Popen([self.installed_path], close_fds=True,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                pass
        self.destroy()


def main():
    if "--uninstall" in sys.argv:
        do_uninstall(silent=("--silent" in sys.argv or "/S" in sys.argv))
        return
    if "--silent" in sys.argv or "/S" in sys.argv:
        # Unattended install: same work, no window. Exit code 0 on success.
        try:
            do_install(True, True, lambda _m: None)
        except Exception as exc:
            sys.stderr.write("install failed: %r\n" % (exc,))
            sys.exit(1)
        sys.exit(0)
    Installer().mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        try:
            r = tk.Tk(); r.withdraw()
            messagebox.showerror(APP_NAME + " Setup", "Could not start: %r" % (exc,))
        except Exception:
            pass


