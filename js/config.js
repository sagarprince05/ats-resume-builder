/* =====================================================================
   Build-time configuration.

   Leave the key empty in the source tree. The build script injects the
   real key into the copy that goes inside the .exe:

       powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -GroqKey "gsk_..."

   When a key is baked in, every API-key setting in the app is hidden.

   Note: a key embedded here is readable by anyone who has the .exe.
   Use a key you are willing to have extracted, and revoke it if it
   spreads further than you intended.
   ===================================================================== */
window.APP_CONFIG = {
  groqKey: '',
  groqModel: 'openai/gpt-oss-120b',
  // Hosted copies: path of the server relay that holds the key, e.g.
  // '/api/groq'. Leave empty for the desktop app and local use.
  groqProxy: ''
};
