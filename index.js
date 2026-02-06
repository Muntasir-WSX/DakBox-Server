const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Admin Setup
const serviceAccount = require("./dakbox-firebase-admin-key.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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
        const db = client.db("dakBoxDB");
        const parcelCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");
        const trackingCollection = db.collection("trackingUpdates");
        const usersCollection = db.collection("users");
        const riderApplicationCollection = db.collection("riderApplications");

        // --- JWT API ---
        app.post("/jwt", async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: "90d",
            });
            res.send({ token });
        });

        // --- Authentication Middleware ---
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
                const userExist = await usersCollection.findOne({ email: email });
                if (userExist) {
                    return res.status(200).send({ message: "User already exists", inserted: false });
                }
                const result = await usersCollection.insertOne(user);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error", error: error.message });
            }
        });

        // --- Rider Application Routes ---

        // 1. GET: All rider applications
        app.get("/rider-applications", verifyToken, async (req, res) => {
            const result = await riderApplicationCollection.find().toArray();
            res.send(result);
        });

        // 2. PATCH: Approve Rider (Role change to 'rider' and Status to 'active')
        // এটি Pending Riders পেজ থেকে কল হবে
        app.patch("/rider-applications/approve/:id", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const { email } = req.body;
                const filter = { _id: new ObjectId(id) };

                // স্ট্যাটাস একটিভ করা
                await riderApplicationCollection.updateOne(filter, { $set: { status: "active" } });
                
                // রোল রাইডার করা
                await usersCollection.updateOne({ email: email }, { $set: { role: "rider" } });

                res.send({ success: true, message: "Rider approved and role updated!" });
            } catch (error) {
                res.status(500).send({ message: "Approval failed", error: error.message });
            }
        });

        // 3. PATCH: Toggle Penalty (Only Status Change, Role remains 'rider')
        // এটি Active Riders পেজ থেকে কল হবে
        app.patch("/rider-applications/toggle-status/:id", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const { currentStatus } = req.body; 
                const filter = { _id: new ObjectId(id) };
                
                // যদি স্ট্যাটাস একটিভ থাকে তবে পেনাল্টি দিবে, আর পেনাল্টি থাকলে আবার রানিং/একটিভ করে দিবে
                const newStatus = currentStatus === "active" ? "penalty" : "active";

                const result = await riderApplicationCollection.updateOne(
                    filter,
                    { $set: { status: newStatus } }
                );

                res.send({ 
                    success: true, 
                    message: `Rider is now ${newStatus === 'active' ? 'Running' : 'on Penalty'}`, 
                    newStatus: newStatus 
                });
            } catch (error) {
                res.status(500).send({ message: "Penalty toggle failed", error: error.message });
            }
        });

        // 4. DELETE: Delete application
        app.delete("/rider-applications/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await riderApplicationCollection.deleteOne(query);
            res.send(result);
        });

        // --- Parcel Routes (Existing) ---
        app.post("/parcels", verifyToken, async (req, res) => {
            const parcel = req.body;
            const result = await parcelCollection.insertOne(parcel);
            res.status(201).send(result);
        });

        app.get("/my-parcels/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) return res.status(403).send({ message: "Forbidden access" });
            const result = await parcelCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        app.get("/parcel/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
            const result = await parcelCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.delete("/parcels/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const parcel = await parcelCollection.findOne(query);
            if (parcel?.status !== "pending") return res.status(400).send({ message: "Cannot cancel!" });
            const result = await parcelCollection.deleteOne(query);
            res.send(result);
        });

        // --- Stripe Payment (Existing) ---
        app.post("/create-payment-intent", verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = Math.round(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount,
                currency: "bdt",
                payment_method_types: ["card"],
            });
            res.send({ clientSecret: paymentIntent.client_secret });
        });

        app.patch("/parcel/payment-success/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const paymentInfo = req.body;
            const filter = { _id: new ObjectId(id) };
            const parcel = await parcelCollection.findOne(filter);
            await paymentsCollection.insertOne({
                parcelId: id,
                transactionId: paymentInfo.transactionId,
                userEmail: parcel.userEmail,
                amount: parcel.totalCharge,
                paymentDate: new Date(),
            });
            const result = await parcelCollection.updateOne(filter, {
                $set: { status: "paid", transactionId: paymentInfo.transactionId, paymentDate: new Date() }
            });
            res.send(result);
        });

    } finally { }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("DakBox Server is running..."));
app.listen(port, () => console.log(`Server running on port: ${port}`));