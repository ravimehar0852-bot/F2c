/* One-time, local-only Admin provisioning.  Usage (from this folder):
     1. Create the admin user in Firebase Console → Authentication → Add user (email + password)
     2. Firebase Console → Project settings → Service accounts → Generate new private key → save here as serviceAccountKey.json (NEVER commit it)
     3. npm install && node make-admin.js admin@example.com
   The user must sign out and sign in again for the claim to apply. */
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
(async () => {
  const email = process.argv[2]; if (!email) { console.log("Usage: node make-admin.js <email>"); process.exit(1); }
  const u = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(u.uid, { admin: true });
  console.log("Admin role granted to", email, "(uid " + u.uid + ")"); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
