const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) {
    return admin;
  }

  try {
    // For development: Use service account key
    // For production: Use environment variables
    const serviceAccount = process.env.FIREBASE_CREDENTIALS 
      ? JSON.parse(process.env.FIREBASE_CREDENTIALS)
      : require(path.join(__dirname, '../serviceAccountKey.json'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 
                  `https://${serviceAccount.project_id}.firebaseio.com`,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 
                    `${serviceAccount.project_id}.appspot.com`,
    });

    console.log('✅ Firebase Admin SDK initialized');
    firebaseInitialized = true;
    
    return admin;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  getFirebaseAdmin: () => {
    if (!firebaseInitialized) {
      initializeFirebase();
    }
    return admin;
  },
  getFirestore: () => {
    if (!firebaseInitialized) {
      initializeFirebase();
    }
    return admin.firestore();
  },
  getMessaging: () => {
    if (!firebaseInitialized) {
      initializeFirebase();
    }
    return admin.messaging();
  },
  getAuth: () => {
    if (!firebaseInitialized) {
      initializeFirebase();
    }
    return admin.auth();
  },
};