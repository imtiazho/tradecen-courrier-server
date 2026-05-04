/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

/* ----- FIREBASE OTP SYSTEM -----*/

// Author Email Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

/* -------- SEND OTP -------- */
exports.sendOTP = functions.https.onCall(async (data, context) => {
  // onCall ফাংশনে ডেটা সরাসরি 'data' প্যারামিটারে আসে
  const { email } = data;

  try {
    const otp = Math.floor(100000 + Math.random() * 900000);

    await admin
      .firestore()
      .collection("otps")
      .doc(email)
      .set({
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

    await transporter.sendMail({
      from: '"TradeCen" <your-email@gmail.com>', // নামসহ ফরম্যাট দেওয়া ভালো
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}`,
    });

    return { success: true };
  } catch (error) {
    console.error("Error sending email:", error);
    // onCall-এ Error থ্রো করতে হয় functions.https.HttpsError ব্যবহার করে
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/* -------- VERIFY OTP -------- */
exports.verifyOTP = functions.https.onCall(async (data) => {
  const { email, otp } = data;

  const doc = await admin.firestore().collection("otps").doc(email).get();

  if (!doc.exists) {
    throw new Error("OTP not found");
  }

  const stored = doc.data();

  if (Date.now() > stored.expiresAt) {
    throw new Error("OTP expired");
  }

  if (parseInt(otp) !== stored.otp) {
    throw new Error("Invalid OTP");
  }

  return { success: true };
});

/* -------- RESET PASSWORD -------- */
exports.resetPassword = functions.https.onCall(async (data) => {
  const { email, newPassword } = data;

  const user = await admin.auth().getUserByEmail(email);

  await admin.auth().updateUser(user.uid, {
    password: newPassword,
  });

  return { success: true };
});
