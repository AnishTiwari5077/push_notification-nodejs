const admin = require('firebase-admin');
const path = require('path');

let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) {
    return admin;
  }

  try {
    let serviceAccount;

    if (process.env.FIREBASE_CREDENTIALS) {
      // Production: use environment variable
      serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
      console.log('🔑 Using FIREBASE_CREDENTIALS environment variable');
    } else if (process.env.NODE_ENV === 'production') {
      // In production, never fall back to a file
      throw new Error(
        'FIREBASE_CREDENTIALS environment variable is required in production. ' +
        'Set it to the full contents of your serviceAccountKey.json as one line.'
      );
    } else {
      // Development only: use local file
      const keyPath = path.join(__dirname, '../serviceAccountKey.json');
      serviceAccount = require(keyPath);
      console.warn(
        '⚠️  DEV MODE: Using local serviceAccountKey.json. ' +
        'Never commit this file or use it in production.'
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET ||
        `${serviceAccount.project_id}.appspot.com`,
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
    firebaseInitialized = true;
    return admin;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  getFirebaseAdmin: () => {
    if (!firebaseInitialized) initializeFirebase();
    return admin;
  },
  getFirestore: () => {
    if (!firebaseInitialized) initializeFirebase();
    return admin.firestore();
  },
  getMessaging: () => {
    if (!firebaseInitialized) initializeFirebase();
    return admin.messaging();
  },
  getAuth: () => {
    if (!firebaseInitialized) initializeFirebase();
    return admin.auth();
  },
};