# CrossLab Icebreaker

A small real-time web app for six groups:
- Rwa1 ↔ Swe1
- Rwa2 ↔ Swe2
- Rwa3 ↔ Swe3

GitHub Pages hosts the frontend. Firebase Authentication (anonymous) identifies browsers and Firebase Realtime Database stores the live session state and answers.

## 1. Create Firebase
1. Create a Firebase project.
2. Add a Web app.
3. Enable **Authentication → Sign-in method → Anonymous**.
4. Create **Realtime Database**.
5. Copy the Web app config into `app.js`.
6. Put the rules from `firebase-rules.json` into Realtime Database → Rules.

Firebase's anonymous authentication is intended for users who do not need an account, and Realtime Database synchronizes data between connected clients.

## 2. Configure
Open `app.js` and replace the `firebaseConfig` values.

Change the `QUESTIONS` array near the top to add/edit questions.

## 3. Publish on GitHub Pages
Upload `index.html`, `style.css`, `app.js`, and `firebase-rules.json` to a GitHub repository.
Enable GitHub Pages for the repository. GitHub Pages serves the static frontend; Firebase provides the realtime backend.

## 4. Start a session
Open the site. The first device can use the **Host** button. The host controls are intentionally lightweight: anyone can advance/reveal, so the app does not require a password.

For a fresh event, use the Host screen's **Reset session** button before students join.

## Important
The included rules are deliberately simple for an 18-person classroom prototype. They require Firebase authentication but allow authenticated users to read/write the session. For a public long-term deployment, tighten the rules or add a host authentication mechanism.
