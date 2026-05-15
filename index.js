const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const dns = require("dns");
const nodemailer = require("nodemailer");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

// stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET);

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
  parcelsCollections,
  paymentCollections,
  hubManagersCollection,
  trackingLogsCollections;

async function connectDB() {
  if (db)
    return {
      userCollections,
      ridersCollections,
      merchantsCollections,
      parcelsCollections,
      paymentCollections,
      hubManagersCollection,
      trackingLogsCollections,
    };

  await client.connect();
  db = client.db("tradeCen_DB");
  userCollections = db.collection("users");
  ridersCollections = db.collection("riders");
  merchantsCollections = db.collection("merchants");
  parcelsCollections = db.collection("parcels");
  paymentCollections = db.collection("payments");
  hubManagersCollection = db.collection("hubManagers");
  trackingLogsCollections = db.collection("trackingLogs");

  return {
    userCollections,
    ridersCollections,
    merchantsCollections,
    parcelsCollections,
    paymentCollections,
    hubManagersCollection,
    trackingLogsCollections,
  };
}

/* ----- Helpers ------ */
const logTracking = async (trackingID, status) => {
  const { trackingLogsCollections } = await connectDB();
  const log = {
    trackingID,
    deliveryStatus: status,
    details: status.split("-").join(" "),
    createdAt: new Date(),
  };
  return await trackingLogsCollections.insertOne(log);
};

/* ---- EXPRESS ROUTES START HERE ----*/

/*---- User Related APIs ----*/
app.get("/users", async (req, res) => {
  try {
    const { userCollections } = await connectDB();
    const searchText = req.query.searchText;
    const role = req.query.role;

    const query = {};

    if (searchText) {
      query.$or = [
        { displayName: { $regex: searchText, $options: "i" } },
        { email: { $regex: searchText, $options: "i" } },
      ];
    }

    if (role) {
      query.role = role;
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

app.patch("/users/make-hub-manager", async (req, res) => {
  try {
    const data = req.body; // { email, region, district, hubName }
    const { email, region, district, hubName } = data;

    const userFilter = { email: email };
    const updateRole = {
      $set: { role: "hub-manager" },
    };
    const updateResult = await userCollections.updateOne(
      userFilter,
      updateRole,
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "User not found or role already updated",
      });
    }

    const userProfile = await userCollections.findOne({ email: email });

    const hubManagerDoc = {
      userId: userProfile._id,
      name: userProfile.displayName,
      email: email,
      photoURL: userProfile.photoURL || "",
      region: region,
      district: district,
      hubName: hubName,
      assignedAt: new Date(),
      status: "active",
    };

    const insertResult = await hubManagersCollection.insertOne(hubManagerDoc);

    if (insertResult.insertedId) {
      res.send({
        success: true,
        message: "User promoted and added to Hub Managers collection",
      });
    }
  } catch (error) {
    console.error("Error adding hub manager:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

/* ---- Managers ---- */
app.get("/users/hub-managers", async (req, res) => {
  try {
    // const email = req.params;
    const { region, district, email } = req.query;

    let query = {};

    if (email) {
      query.email = email;
    }

    if (region) {
      query.region = region;
    }

    if (district) {
      query.district = district;
    }

    const result = await hubManagersCollection.find(query).toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching managers:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/parcels/incoming/:hubName", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const hubName = req.params.hubName;
    const query = {
      $or: [
        {
          "serviceCenters.origin": hubName,
          deliveryStatus: "parcel-created",
        },
        {
          "serviceCenters.origin": hubName,
          deliveryStatus: "assign-pickup-rider",
        },
        {
          "serviceCenters.destination": hubName,
          deliveryStatus: "in-transit",
        },
      ],
    };

    const result = await parcelsCollections.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Error fetching incoming parcels",
      error: error.message,
    });
  }
});

app.get("/warehouse/sorting-house/:hubName", async (req, res) => {
  try {
    const { hubName } = req.params;
    const { parcelsCollections } = await connectDB();

    const dispatchList = await parcelsCollections
      .find({
        deliveryStatus: "reached-origin-warehouse",
        "senderInfo.area": hubName,
      })
      .toArray();

    const deliveryList = await parcelsCollections
      .find({
        deliveryStatus: "reached-destination-warehouse",
        "receiverInfo.area": hubName,
      })
      .toArray();

    res.send({ dispatchList, deliveryList });
  } catch (error) {
    res.status(500).send({ message: "Error sorting parcels" });
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

// app.get("/riders", async (req, res) => {
//   try {
//     const { ridersCollections } = await connectDB();
//     const status = req.query.status;
//     let query = {};

//     if (status) {
//       query = { status: status };
//     }

//     const result = await ridersCollections.find(query).toArray();

//     res.status(200).send(result);
//   } catch (error) {
//     console.error("Error fetching riders:", error);
//     res.status(500).send({ message: "Internal Server Error" });
//   }
// });

app.get("/riders", async (req, res) => {
  try {
    const { ridersCollections } = await connectDB();
    const { status, workStatus, email } = req.query;
    let query = {};

    if (status) {
      query.status = status;
    }

    if (workStatus) {
      query.workStatus = workStatus;
    }

    if (email) {
      query.email = email;
    }

    const result = await ridersCollections.find(query).toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching riders:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/riders/available/:areaName", async (req, res) => {
  try {
    const { areaName } = req.params;
    const { ridersCollections } = await connectDB();

    const query = {
      area: areaName,
      workStatus: "available",
      currentTasks: { $lt: 10 },
    };

    const riders = await ridersCollections.find(query).toArray();
    res.status(200).send(riders);
  } catch (error) {
    res
      .status(500)
      .send({ message: "Error fetching riders", error: error.message });
  }
});

app.patch("/riders/:id", async (req, res) => {
  try {
    const { ridersCollections, userCollections } = await connectDB();
    const id = req.params.id;
    const { status, workStatus, email } = req.body;

    const riderFilter = { _id: new ObjectId(id) };
    const riderUpdate = {
      $set: {
        status: status,
        workStatus: workStatus,
        updatedAt: new Date(),
      },
    };

    const riderResult = await ridersCollections.updateOne(
      riderFilter,
      riderUpdate,
    );

    if (riderResult.modifiedCount > 0) {
      const userFilter = { email: email };
      const userUpdate = {
        $set: {
          role: "rider",
        },
      };

      const userResult = await userCollections.updateOne(
        userFilter,
        userUpdate,
      );

      res.send({
        success: true,
        message: "Rider approved and user role updated to rider",
        riderResult,
        userResult,
      });
    } else {
      res.status(404).send({ message: "Rider not found or no changes made" });
    }
  } catch (error) {
    console.error("Error approving rider:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.patch("/parcels/assign-rider", async (req, res) => {
  try {
    const { parcelId, riderId, riderName, riderEmail, riderPhone, trackingID } =
      req.body;
    const { parcelsCollections, ridersCollections } = await connectDB();
    const parcelData = await parcelsCollections.findOne({
      _id: new ObjectId(parcelId),
    });
    const parcelUpdate = await parcelsCollections.updateOne(
      { _id: new ObjectId(parcelId) },
      {
        $set: {
          deliveryStatus: "assign-pickup-rider",
          pickupRider: {
            id: riderId,
            name: riderName,
            email: riderEmail,
            phone: riderPhone,
          },
        },
      },
    );

    const riderUpdate = await ridersCollections.updateOne(
      { _id: new ObjectId(riderId) },
      {
        $inc: { currentTasks: 1 },
        $push: {
          activeTasks: {
            parcelId: new ObjectId(parcelId),
            trackingID: trackingID,
            pickupLocation: parcelData.senderInfo.address,
            merchantName: parcelData.senderInfo.name,
            merchantPhone: parcelData.senderInfo.phone,
            taskType: "pickup",
            assignedAt: new Date(),
          },
        },
      },
    );

    if (parcelUpdate.modifiedCount > 0 && riderUpdate.modifiedCount > 0) {
      res
        .status(200)
        .send({ success: true, message: "Rider assigned successfully" });
    } else {
      res.status(400).send({ message: "Assignment failed" });
    }
  } catch (error) {
    res.status(500).send({ message: "Server error", error: error.message });
  }
});

app.patch("/parcels/assign-delivery", async (req, res) => {
  try {
    const { parcelId, riderId, riderName, riderEmail, riderPhone, trackingID } =
      req.body;
    const { parcelsCollections, ridersCollections } = await connectDB();
    const parcelData = await parcelsCollections.findOne({
      _id: new ObjectId(parcelId),
    });

    const parcelUpdate = await parcelsCollections.updateOne(
      { _id: new ObjectId(parcelId) },
      {
        $set: {
          deliveryStatus: "assign-delivery-rider",
          deliveryRider: {
            id: riderId,
            name: riderName,
            email: riderEmail,
            phone: riderPhone,
          },
        },
      },
    );

    const riderUpdate = await ridersCollections.updateOne(
      { _id: new ObjectId(riderId) },
      {
        $inc: { currentTasks: 1 },
        $push: {
          activeTasks: {
            parcelId: new ObjectId(parcelId),
            trackingID: trackingID,
            deliveryLocation: parcelData.receiverInfo.address,
            consumerName: parcelData.receiverInfo.name,
            consumerPhone: parcelData.receiverInfo.phone,
            taskType: "delivery",
            assignedAt: new Date(),
          },
        },
      },
    );

    if (parcelUpdate.modifiedCount > 0 && riderUpdate.modifiedCount > 0) {
      res
        .status(200)
        .send({ success: true, message: "Rider assigned successfully" });
    } else {
      res.status(400).send({ message: "Assignment failed" });
    }
  } catch (error) {
    res.status(500).send({ message: "Server error", error: error.message });
  }
});

app.patch("/riders/complete-pickup/update", async (req, res) => {
  try {
    const { riderId, parcelId, trackingID } = req.body;
    const { parcelsCollections, ridersCollections } = await connectDB();

    await parcelsCollections.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { deliveryStatus: "reached-origin-warehouse" } },
    );

    const result = await ridersCollections.updateOne(
      { _id: new ObjectId(riderId) },
      {
        $inc: { currentTasks: -1 },
        $pull: { activeTasks: { parcelId: new ObjectId(parcelId) } },
      },
    );

    res.send({ success: true, result });
    console.log(riderId, parcelId, trackingID);
  } catch (error) {
    res
      .status(500)
      .send({ message: "Error completing pickup", error: error.message });
  }
});

app.patch("/riders/complete-delivered/update", async (req, res) => {
  try {
    const { riderId, parcelId, trackingID } = req.body;
    const { parcelsCollections, ridersCollections } = await connectDB();

    await parcelsCollections.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { deliveryStatus: "delivered" } },
    );

    const result = await ridersCollections.updateOne(
      { _id: new ObjectId(riderId) },
      {
        $inc: { currentTasks: -1 },
        $pull: { activeTasks: { parcelId: new ObjectId(parcelId) } },
      },
    );

    res.send({ success: true, result });
    console.log(riderId, parcelId, trackingID);
  } catch (error) {
    res
      .status(500)
      .send({ message: "Error completing pickup", error: error.message });
  }
});

app.delete("/riders/:id", async (req, res) => {
  try {
    const { ridersCollections, usersCollection } = await connectDB();
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const riderData = await ridersCollections.findOne(query);

    if (!riderData) {
      return res
        .status(404)
        .send({ success: false, message: "Rider request not found" });
    }

    const deleteResult = await ridersCollections.deleteOne(query);

    if (deleteResult.deletedCount > 0) {
      const userFilter = { email: riderData.email };
      const userUpdate = {
        $set: {
          role: "user",
        },
      };

      const userUpdateResult = await usersCollection.updateOne(
        userFilter,
        userUpdate,
      );

      res.send({
        success: true,
        message: "Rider request deleted and user role reset to user",
        deleteResult,
        userUpdateResult,
      });
    }
  } catch (error) {
    console.error("Error rejecting rider:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
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
app.get("/parcels", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const skip = parseInt(req.query.skip);
    const limit = parseInt(req.query.limit);
    const { email, filter, search } = req.query;

    let startDate = new Date();
    if (filter === "this-week") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (filter === "last-week") {
      startDate.setDate(startDate.getDate() - 14);
    } else if (filter === "last-month") {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate = null;
    }

    const query = { "senderInfo.email": email };
    if (startDate) {
      query.createdAt = { $gte: startDate.toISOString() };
    }
    if (req.query.status) {
      query.deliveryStatus = req.query.status;
    }
    // if (search) {
    //   query.$or = [
    //     { trackingID: { $regex: search, $options: "i" } },
    //     { "receiverInfo.name": { $regex: search, $options: "i" } },
    //   ];
    // }

    const result = await parcelsCollections
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const count = await parcelsCollections.countDocuments(query);

    res.send({ count, data: result });
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/parcels/unpaid/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { parcelsCollections } = await connectDB();

    const query = {
      "senderInfo.email": email,
      deliveryChargeStatus: "unpaid",
    };

    const unpaidParcels = await parcelsCollections
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    const totalDue = unpaidParcels.reduce(
      (sum, parcel) => sum + (parcel.deliveryCharge || 0),
      0,
    );

    res.status(200).send({
      success: true,
      totalDue,
      count: unpaidParcels.length,
      data: unpaidParcels,
    });
  } catch (error) {
    console.error("Error fetching unpaid parcels:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

app.get("/parcels/status/:email", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const email = req.params.email;
    const status = req.query.status;

    let query = { "senderInfo.email": email };

    if (status) {
      query.deliveryStatus = status;
    }

    const result = await parcelsCollections.find(query).toArray();

    res.send(result);
  } catch (error) {
    console.error("Error loading filtered parcels:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
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
      if (element._id === "ready-to-pickup")
        formattedData.readyPickUp = element.count;
      if (element._id === "in-transit") formattedData.inTransit = element.count;
      if (element._id === "ready-to-deliver")
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

app.post("/parcels", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const newParcel = req.body;
    await logTracking(newParcel.trackingID, newParcel.deliveryStatus);
    const result = await parcelsCollections.insertOne(newParcel);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.delete("/parcel/:id", async (req, res) => {
  try {
    const { parcelsCollections } = await connectDB();
    const result = await parcelsCollections.deleteOne({
      _id: new ObjectId(req.params.id),
    });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.patch("/parcels/dispatch/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { parcelsCollections } = await connectDB();

    const result = await parcelsCollections.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          deliveryStatus: "in-transit",
          currentLocation: "Moving to Destination Hub",
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount > 0) {
      res.send({
        success: true,
        message: "Parcel status updated to in-transit",
      });
    } else {
      res.status(404).send({ success: false, message: "Parcel not found" });
    }
  } catch (error) {
    res.status(500).send({ message: "Server Error", error: error.message });
  }
});

app.patch("/parcels/hub/received/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { parcelsCollections } = await connectDB();

    const result = await parcelsCollections.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          deliveryStatus: "reached-destination-warehouse",
          currentLocation: "destination-warehouse",
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount > 0) {
      res.send({
        success: true,
        message: "Parcel status updated to in-transit",
      });
    } else {
      res.status(404).send({ success: false, message: "Parcel not found" });
    }
  } catch (error) {
    res.status(500).send({ message: "Server Error", error: error.message });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("🚀 TradeCen Server Running");
});

/* ----- Payment Method -----*/
app.post("/payment-checkout", async (req, res) => {
  const paymentInfo = req.body;
  const amount = parseInt(paymentInfo.deliveryCharge) * 100;
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: "USD",
          unit_amount: amount,
          product_data: {
            name: `Payment checkout for ${paymentInfo.parcelName}`,
          },
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    metadata: {
      parcelId: paymentInfo.parcelId,
      percelName: paymentInfo.percelName,
      trackingID: paymentInfo.trackingID,
    },
    customer_email: paymentInfo.senderEmail,
    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
  });

  res.send({ url: session.url });
});

app.patch("/verify-payment", async (req, res) => {
  const { paymentCollections, parcelsCollections } = await connectDB();
  const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
  const transactionId = session.payment_intent;

  const paymentExisted = await paymentCollections.findOne({ transactionId });
  if (paymentExisted)
    return res.send({
      message: "Already exist",
      ...paymentExisted,
      transactionId,
      trackingID: paymentExisted.trackingID,
    });

  const trackingID = session.metadata.trackingID;
  if (session.payment_status === "paid") {
    await parcelsCollections.updateOne(
      { _id: new ObjectId(session.metadata.parcelId) },
      {
        $set: {
          deliveryChargeStatus: "paid",
        },
      },
    );

    const paymentHistory = {
      product: session.metadata.percelName,
      amount: session.amount_total / 100,
      customer_email: session.customer_email,
      transactionId,
      trackingID,
      paidAt: new Date(),
    };
    await paymentCollections.insertOne(paymentHistory);

    // Logs Stream Here

    return res.send({
      success: true,
      ...paymentHistory,
      transactionId,
      trackingID,
    });
  }
  res.send({ success: false });
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
