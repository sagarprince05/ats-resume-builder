/* =====================================================================
   Build-time configuration.

   Leave every key empty in the source tree. The build script injects the
   real keys into the copy that goes inside the .exe:

       powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -GroqKey "gsk_..." -GeminiKey "AQ...."

   Either key alone is enough. With both, Groq is used first and Gemini
   takes over automatically when Groq is busy (set provider to 'gemini'
   to reverse that). When any key is baked in, every API-key setting in
   the app is hidden.

   Hosted copies set relay to the path of the server relay that holds the
   keys (e.g. '/api'); see hosting/HOSTING.md.

   Note: a key embedded here is readable by anyone who has the .exe.
   Use keys you are willing to have extracted, and revoke them if they
   spread further than you intended.
   ===================================================================== */
window.APP_CONFIG = {
  groqKey: '',
  groqModel: 'openai/gpt-oss-120b',
  geminiKey: '',
  geminiModel: 'gemini-3.8-flash',
  provider: '',        // '' = Groq if it has a key, otherwise Gemini
  relay: ''            // '' = call the providers directly from the browser
};
