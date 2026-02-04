const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken"); // 1. Added JWT import
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());


const serviceAccount = require("./dakbox-firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@simple-crud-server.a0arf8b.mongodb.net/?appName=simple-crud-server`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    console.log("Database connected!");

    const db = client.db("dakBoxDB");
    const parcelCollection = db.collection("parcels");
    const paymentsCollection = db.collection("payments");
    const trackingCollection = db.collection("trackingUpdates");
    const usersCollection = db.collection("users");

    // --- JWT API ---
    // Generate token for authenticated users
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // --- Authentication Middleware ---
    // Verify if the token provided in headers is valid
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // --- User API ---
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const email = user.email;

        // Check if user already exists in DB
        const userExist = await usersCollection.findOne({ email: email });
        if (userExist) {
          return res
            .status(200)
            .send({ message: "User already exists", inserted: false });
        }

        // Insert new user
        const result = await usersCollection.insertOne(user);
        res.status(201).send(result);
      } catch (error) {
        console.error("Database Error:", error);
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    // --- Parcel Routes ---

    // 1. POST: Create a new parcel (Protected)
    app.post("/parcels", verifyToken, async (req, res) => {
      try {
        const parcel = req.body;
        const result = await parcelCollection.insertOne(parcel);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    // 2. GET: Fetch parcels by user email (Protected + Email Verification)
    app.get("/my-parcels/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      // Security: Ensure the requester email matches the token email
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const query = { userEmail: email };
      const result = await parcelCollection.find(query).toArray();
      res.send(result);
    });

    // 3. GET: Get specific parcel details (Protected)
    app.get("/parcel/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: "Invalid ID" });
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    // 4. DELETE: Cancel/Delete a parcel (Protected)
    app.delete("/parcels/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const parcel = await parcelCollection.findOne(query);
      if (parcel?.status !== "pending") {
        return res
          .status(400)
          .send({ message: "Cannot cancel! Already " + parcel.status });
      }
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    // --- Tracking Routes (Public Access) ---

    app.get("/tracking/:tracingId", async (req, res) => {
      const tracingId = req.params.tracingId;
      const query = { tracingId: tracingId };
      const updates = await trackingCollection
        .find(query)
        .sort({ time: 1 })
        .toArray();
      res.send(updates);
    });

    app.get("/track-parcel-info/:tracingId", async (req, res) => {
      const tracingId = req.params.tracingId;
      const query = { tracingId: tracingId };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    // --- Payment Routes ---

    // 1. Create Payment Intent (Protected)
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      try {
        const { price } = req.body;
        if (!price || price < 1)
          return res.status(400).send({ message: "Invalid price" });
        const amount = Math.round(price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "bdt",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // 2. Update status after successful payment (Protected)
    app.patch("/parcel/payment-success/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const paymentInfo = req.body;
        const filter = { _id: new ObjectId(id) };

        const parcel = await parcelCollection.findOne(filter);
        if (!parcel)
          return res.status(404).send({ message: "Parcel not found" });

        const paymentRecord = {
          parcelId: id,
          tracingId: parcel.tracingId,
          transactionId: paymentInfo.transactionId,
          userEmail: parcel.userEmail,
          userName: parcel.userName,
          amount: parcel.totalCharge,
          parcelType: parcel.parcelType,
          paymentDate: new Date(),
        };
        const insertResult = await paymentsCollection.insertOne(paymentRecord);

        const trackingUpdate = {
          parcelId: id,
          tracingId: parcel.tracingId,
          status: "Payment Confirmed",
          message: "Parcel is ready for processing.",
          time: new Date(),
        };
        await trackingCollection.insertOne(trackingUpdate);

        const updatedDoc = {
          $set: {
            status: "paid",
            transactionId: paymentInfo.transactionId,
            paymentDate: new Date(),
          },
        };
        const updateResult = await parcelCollection.updateOne(filter, updatedDoc);

        res.send({ success: true, updateResult, insertResult });
      } catch (error) {
        res.status(500).send({ message: "Database update failed", error: error.message });
      }
    });

    // 3. GET: Payment History (Protected)
    app.get("/payment-history", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};
        if (email) {
          query.userEmail = email;
        }
        const result = await paymentsCollection
          .find(query)
          .sort({ paymentDate: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching history" });
      }
    });

  } finally {
    // Keep connection open
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("DakBox Server is humming along...");
});

app.listen(port, () => {
  console.log(`Server is flying on port: ${port}`);
});