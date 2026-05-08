const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const dns = require("dns");
const nodemailer = require("nodemailer");

const { MongoClient, ServerApiVersion } = require("mongodb");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// DNS fix
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// middleware
app.use(cors());
app.use(express.json());

/* ---- MONGODB SETUP -----*/
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ab3rgue.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db, userCollections, ridersCollections, merchantsCollections;

async function connectDB() {
  if (db) return { userCollections, ridersCollections, merchantsCollections };

  await client.connect();
  db = client.db("tradeCen_DB");
  userCollections = db.collection("users");
  ridersCollections = db.collection("riders");
  merchantsCollections = db.collection("merchants");

  return { userCollections, ridersCollections, merchantsCollections };
}

/* ---- EXPRESS ROUTES START HERE ----*/

/*---- User Related APIs ----*/
// Load User
app.get("/users", async (req, res) => {
  try {
    const { userCollections } = await connectDB();
    const searchText = req.query.searchText;

    const query = {};

    if (searchText) {
      query.$or = [
        { displayName: { $regex: searchText, $options: "i" } },
        { email: { $regex: searchText, $options: "i" } },
      ];
    }

    const result = await userCollections
      .find(query)
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/user/:email", async (req, res) => {
  try {
    const { userCollections } = await connectDB();
    const email = req.params.email;
    const user = await userCollections.findOne({ email: email });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found in database",
      });
    }

    res.send({
      success: true,
      role: user.role,
      isOnboarded: user.isOnboarded,
      email: user.email,
      ...user,
    });
  } catch (error) {
    res.status(500).send({ success: false, error: "Internal Server Error" });
  }
});

app.patch("/users/update/:email", async (req, res) => {
  try {
    const { userCollections } = await connectDB();
    const result = await userCollections.updateOne(
      { email: req.params.email },
      {
        $set: {
          ...req.body,
        },
      },
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({ success: false, error: "Internal Server Error" });
  }
});

// Create user
app.post("/users", async (req, res) => {
  try {
    const { userCollections } = await connectDB();

    const user = req.body;

    const isExist = await userCollections.findOne({ email: user.email });

    if (isExist) {
      return res.send({ message: "User already exists" });
    }

    const result = await userCollections.insertOne(user);

    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// User isOnboarded status update
app.patch("/users/verify-status/:email", async (req, res) => {
  try {
    const { userCollections } = await connectDB();
    const result = await userCollections.updateOne(
      { email: req.params.email },
      {
        $set: {
          isOnboarded: true,
        },
      },
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

/*---- Rider Related APIs ----*/
app.post("/riders", async (req, res) => {
  try {
    const { ridersCollections } = await connectDB();
    const newRider = req.body;
    const isExist = await ridersCollections.findOne({ email: newRider.email });
    if (isExist) {
      return res.send({ message: "This email already used for rider!" });
    }

    const result = await ridersCollections.insertOne(newRider);
    const userRes = await userCollections.updateOne(
      { email: newRider.email },
      {
        $set: {
          role: "pending-rider",
        },
      },
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

/* ---- Merchant APIs ---- */
app.post("/merchants", async (req, res) => {
  try {
    const { merchantsCollections } = await connectDB();
    const newMerchant = req.body;
    const isExist = await merchantsCollections.findOne({
      email: newMerchant.email,
    });
    if (isExist) {
      return res.send({ message: "This email already used for Merchant!" });
    }

    const result = await merchantsCollections.insertOne(newMerchant);
    const userRes = await userCollections.updateOne(
      { email: newMerchant.email },
      {
        $set: {
          role: "merchant",
        },
      },
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("🚀 TradeCen Server Running");
});

/* ----- OTP SYSTEM (Express Routes) -----*/

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).send({ error: "Email is required" });

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
      from: `"TradeCen" <${process.env.EMAIL}>`,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
    });

    res.send({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).send({ error: error.message });
  }
});

app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const doc = await admin.firestore().collection("otps").doc(email).get();

    if (!doc.exists) {
      return res.status(404).send({ error: "OTP not found. Please resend." });
    }

    const stored = doc.data();

    if (Date.now() > stored.expiresAt) {
      return res.status(400).send({ error: "OTP has expired" });
    }

    if (parseInt(otp) !== stored.otp) {
      return res.status(400).send({ error: "Invalid OTP code" });
    }

    res.send({ success: true, message: "OTP verified" });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, {
      password: newPassword,
    });

    await admin.firestore().collection("otps").doc(email).delete();

    res.send({ success: true, message: "Password updated successfully" });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

/* ---- START SERVER ---- */

connectDB()
  .then(() => {
    console.log("🚀 MongoDB Connected");

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
  });
