const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const dns = require("dns");
const nodemailer = require("nodemailer");

const { MongoClient, ServerApiVersion } = require("mongodb");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const { stat } = require("fs");

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

let db,
  userCollections,
  ridersCollections,
  merchantsCollections,
  parcelsCollections;

async function connectDB() {
  if (db)
    return {
      userCollections,
      ridersCollections,
      merchantsCollections,
      parcelsCollections,
    };

  await client.connect();
  db = client.db("tradeCen_DB");
  userCollections = db.collection("users");
  ridersCollections = db.collection("riders");
  merchantsCollections = db.collection("merchants");
  parcelsCollections = db.collection("parcels");

  return {
    userCollections,
    ridersCollections,
    merchantsCollections,
    parcelsCollections,
  };
}

/* ---- EXPRESS ROUTES START HERE ----*/

/*---- User Related APIs ----*/
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

app.get("/user/:email/role", async (req, res) => {
  try {
    const { userCollections } = await connectDB();
    const user = await userCollections.findOne({ email: req.params.email });
    res.send({ role: user.role });
  } catch (error) {}
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

/*---- Rider Related APIs Start ----*/
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

/* ---- Merchant APIs Start ---- */
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

app.get("/merchant/:email", async (req, res) => {
  try {
    const { merchantsCollections } = await connectDB();
    const email = req.params.email;
    const merchant = await merchantsCollections.findOne({ email: email });

    if (!merchant) {
      return res.status(404).send({
        success: false,
        message: "User not found in database",
      });
    }

    res.send({
      success: true,
      role: merchant.role,
      email: merchant.email,
      ...merchant,
    });
  } catch (error) {
    res.status(500).send({ success: false, error: "Internal Server Error" });
  }
});

/*---- Parcels Related APIs ----*/
app.post("/parcels", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const newParcel = req.body;
    const result = await parcelsCollections.insertOne(newParcel);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/parcels", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const result = await parcelsCollections.find().toArray();
    res.send(result);
  } catch (error) {}
});

app.get("/parcels/stats/:email", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const stats = await parcelsCollections
      .aggregate([
        {
          $match: { "senderInfo.email": req.params.email },
        },
        {
          $group: {
            _id: "$deliveryStatus",
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const formattedData = {
      toPay: 0,
      readyPickUp: 0,
      inTransit: 0,
      readyDeliver: 0,
      delivered: 0,
    };

    stats.forEach((element) => {
      if (element._id === "parcel-created") formattedData.toPay = element.count;
      if (element._id === "ready-pickup")
        formattedData.readyPickUp = element.count;
      if (element._id === "in-transit") formattedData.inTransit = element.count;
      if (element._id === "ready-deliver")
        formattedData.readyDeliver = element.count;
      if (element._id === "delivered") formattedData.delivered = element.count;
    });

    res.send(formattedData);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/revenue/stats/:email", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const { filter } = req.query;

    let startDate = new Date();

    if (filter === "this-week") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (filter === "last-week") {
      startDate.setDate(startDate.getDate() - 14);
    } else if (filter === "last-month") {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setDate(startDate.getDate() - 7);
    }

    const stats = await parcelsCollections
      .aggregate([
        {
          $match: {
            "senderInfo.email": req.params.email,
            deliveryStatus: "delivered",
            createdAt: { $gte: startDate.toISOString() },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%d %b",
                date: { $toDate: "$createdAt" },
              },
            },
            totalRevenue: { $sum: "$cost" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const chartData = stats.map((element) => ({
      name: element._id,
      value: element.totalRevenue,
    }));

    res.send(chartData);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/merchant-parcels/:email", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const email = req.params.email;

    const result = await parcelsCollections
      .find({ "senderInfo.email": email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error loading reports" });
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
