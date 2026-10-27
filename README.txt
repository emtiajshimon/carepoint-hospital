CarePoint Hospital — Hospital Management Website with AI Report Chat
=====================================================================
CleverCreator Campus Ambassador task · Built by Emtiaj Nur Shimon

WHAT THIS IS
A plain HTML/CSS/JS hospital management site (no frameworks). All data is
stored in the browser's localStorage — no real patient data anywhere; the
sample data is 100% fake. Reports compute real totals from that data, and an
AI chat page answers staff questions about the reports via the ChatterMate API.

FILES
- index.html            Dashboard — key numbers, menu, "Load sample data" button
- patients.html         Patient registration + searchable patient list
- visits.html           Doctor visit / prescription (adds visit fee to the bill)
- lab.html              Lab test ordering, pending/done status, results entry
- billing.html          What a patient owes, payments (cash/card/bKash), total/paid/due
- reports.html          Reports hub — daily collection report with date filter
- report-patients.html  Patient list report (date range, total row, Print button)
- report-doctors.html   Doctor-wise visits and fees report (date range, Print button)
- report-lab.html       Lab tests ordered/done/pending report (date range, Print button)
- chat.html             AI report chat — asks questions, answers only from report data
- settings.html         Settings — paste your ChatterMate API key here (saved in
                        this browser only, never in a project file, never pushed)
- server.js             Local server: serves pages + POST /ask proxy to ChatterMate API
- .env                  Placeholder only. Put YOUR key here only for local runs.
                        NEVER commit a real key — .env is ignored by git.
- .env.example          The shape of .env, with a placeholder instead of a key
- .gitignore            Keeps .env, node_modules/ and server.log out of git

HOW TO RUN
1. Run:  node server.js
   (If you use .env, run:  node --env-file=.env server.js)
2. Open:  http://localhost:3000
3. Open Settings (top menu) and paste your ChatterMate API key, then press
   Save key. Anyone testing this project pastes their OWN key here — nobody
   needs to share a key with anyone.
   Alternative: put your key in .env as CHATTERMATE_API_KEY=cm_live_...
   The Settings key wins when both exist; the .env key is the fallback.
4. On the dashboard, click "Load sample data" (50 fake patients, 5 doctors,
   one month of visits/tests/payments) before trying reports or the AI chat.

AI CHAT RULES (enforced in the system prompt)
- Answers only from the report data it is given — never invents numbers
- Says "I don't know" when the data doesn't have the answer
- Cannot change any data; refuses edit/delete requests

PUSHING TO GITHUB — CHECK BEFORE YOU PUSH
1. In the project folder, run:  git status
   Make sure .env is NOT in the list. (.gitignore already excludes it.)
2. If .env ever shows up in git status, do NOT commit it. Check that the
   .gitignore file is present in the folder.
3. Never push a real API key. If a real key is ever pushed by mistake,
   delete the file from the repo AND replace the key (revoke the old one
   and make a new one) — deleting alone does not remove it from git history.
4. Reviewers test with their own key: they run the server, open Settings,
   paste their ChatterMate key, and use the AI chat. No key exchange needed.

BUILD PROCESS — CHATTERMATE CHAT LINKS
The code was built step-by-step through ChatterMate prompts (one screen per
prompt, then reports, then the AI chat), visible in these shared chats:
- https://chattermate.ai/shared/c3b63b76653c28fbdc919e028917f3ee
(Add any other chat links here before submitting.)
