const { MongoClient, ServerApiVersion } = require("mongodb");
const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 5000;
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Middleware
app.use(express.json());
app.use(cors());

// ----- Mongo DB Client Set Up -----
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ab3rgue.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Database Connection Caching
let db, userCollections;
async function connectDB() {
  if (db) {
    return { userCollections };
  }

  await client.connect();
  db = client.db("tradeCen_DB");
  userCollections = db.collection("users");

  return { userCollections };
}

// --- API Routes ---

app.post("/users", async (req, res) => {
  const { userCollections } = await connectDB();
  const user = req.body;
  ((user.role = "user"), (user.createdAt = new Date()));

  const isExist = await userCollections.findOne({ email: user.email });
  if (isExist) {
    return res.send({ message: "User Already Exist in DB! No Need To Insert" });
  }

  const result = await userCollections.insertOne(user);
  res.send(result);
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
