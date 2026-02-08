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
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

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

        // --- Authentication Middlewares ---
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

        // Middlewares (Fixed Logic)
    
const verifyAdmin = async (req, res, next) => {
    const email = req.decoded.email;
    const query = { email: { $regex: new RegExp(`^${email}$`, 'i') } }; // Case insensitive check
    const user = await usersCollection.findOne(query);
    const isAdmin = user?.role === 'admin';
    if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
    }
    next();
};


        // --- JWT API ---
        app.post("/jwt", async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: "90d",
            });
            res.send({ token });
        });

        // --- User APIs ---
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


        app.get("/user-role", verifyToken, async (req, res) => {
    const email = req.query.email;
    if (req.decoded.email !== email) {
        return res.status(403).send({ message: 'Forbidden access' });
    }
    const query = { email: { $regex: new RegExp(`^${email}$`, 'i') } };
    const user = await usersCollection.findOne(query);
    res.send({ role: user?.role || 'user' });
    });

        // --- Admin APIs (Place these carefully) ---
        app.get("/users/admin-list", verifyToken, verifyAdmin, async (req, res) => {
            try {
                const email = req.query.email;
                let query = {};
                if (email) {
                    query = { email: { $regex: email.trim(), $options: "i" } };
                }
                const result = await usersCollection.find(query).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Error fetching users", error: error.message });
            }
        });

        app.patch("/users/make-admin/:id", verifyToken, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                const { role } = req.body;
                const filter = { _id: new ObjectId(id) };
                const updateDoc = { $set: { role: role } };
                const result = await usersCollection.updateOne(filter, updateDoc);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update role" });
            }
        });

        // --- Rider Application Routes ---
        app.post("/rider-applications", verifyToken,  async (req, res) => {
            try {
                const application = req.body;
                const query = { email: application.email };
                const exist = await riderApplicationCollection.findOne(query);
                if (exist) {
                    return res.status(400).send({ message: "Application already submitted!" });
                }
                const result = await riderApplicationCollection.insertOne(application);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: "Server Error", error: error.message });
            }
        });

        app.get("/rider-applications", verifyToken, verifyAdmin, async (req, res) => {
            const result = await riderApplicationCollection.find().toArray();
            res.send(result);
        });

        app.patch("/rider-applications/approve/:id", verifyToken, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const application = await riderApplicationCollection.findOne(query);
                if (!application) {
                    return res.status(404).send({ success: false, message: "Application not found!" });
                }
                const targetEmail = application.email;
                const appUpdate = await riderApplicationCollection.updateOne(query, {
                    $set: { status: "active" },
                });
                let userUpdateResult = { modifiedCount: 0 };
                if (appUpdate.modifiedCount > 0) {
                    userUpdateResult = await usersCollection.updateOne(
                        { email: targetEmail },
                        { $set: { role: "rider" } }
                    );
                }
                res.send({
                    success: true,
                    message: `Approved! User ${targetEmail} is now a rider.`,
                    appModified: appUpdate.modifiedCount,
                    userModified: userUpdateResult.modifiedCount,
                });
            } catch (error) {
                res.status(500).send({ success: false, message: "Server Error", error: error.message });
            }
        });

        app.patch("/rider-applications/toggle-status/:id", verifyToken, verifyAdmin,  async (req, res) => {
            try {
                const id = req.params.id;
                const { currentStatus } = req.body;
                const newStatus = currentStatus === "active" ? "penalty" : "active";
                const result = await riderApplicationCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: newStatus } }
                );
                res.send({ success: true, newStatus });
            } catch (error) {
                res.status(500).send({ message: "Toggle failed" });
            }
        });

        app.delete("/rider-applications/:id", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const application = await riderApplicationCollection.findOne({ _id: new ObjectId(id) });
                if (!application) return res.status(404).send({ message: "Not found" });
                const deleteResult = await riderApplicationCollection.deleteOne({ _id: new ObjectId(id) });
                await usersCollection.updateOne(
                    { email: application.email },
                    { $set: { role: "user" } }
                );
                res.send(deleteResult);
            } catch (error) {
                res.status(500).send({ message: "Delete failed" });
            }
        });

        // --- Parcel Routes ---
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
            const result = await parcelCollection.findOne({ _id: new ObjectId(id),userEmail: req.decoded.email });
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

        // --- Stripe Payment ---
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
            try {
                const id = req.params.id;
                const paymentInfo = req.body;
                const filter = { _id: new ObjectId(id) };
                const parcel = await parcelCollection.findOne(filter);
                if (!parcel) return res.status(404).send({ success: false, message: "Parcel not found" });

                const paymentDoc = {
                    parcelId: id,
                    tracingId: paymentInfo.tracingId,
                    transactionId: paymentInfo.transactionId,
                    userEmail: parcel.userEmail,
                    amount: parcel.totalCharge,
                    paymentDate: new Date(),
                };
                await paymentsCollection.insertOne(paymentDoc);

                const result = await parcelCollection.updateOne(filter, {
                    $set: {
                        status: "paid",
                        transactionId: paymentInfo.transactionId,
                        paymentDate: new Date(),
                    },
                });

                if (result.modifiedCount > 0) {
                    const initialTracking = {
                        tracingId: paymentInfo.tracingId,
                        status: "Payment Confirmed",
                        message: "Your payment is successful. Parcel is ready for processing.",
                        time: new Date(),
                    };
                    await trackingCollection.insertOne(initialTracking);
                    res.send({ success: true, message: "Payment recorded successfully" });
                } else {
                    res.send({ success: false, message: "Failed to update parcel status" });
                }
            } catch (error) {
                res.status(500).send({ success: false, message: "Internal Server Error" });
            }
        });

        app.get("/payment-history", verifyToken, async (req, res) => {
            try {
                const email = req.query.email;
                if (email !== req.decoded.email) return res.status(403).send({ message: "Forbidden access" });
                const result = await paymentsCollection.find({ userEmail: email }).sort({ paymentDate: -1 }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Error fetching history" });
            }
        });

        // --- Tracking APIs ---
        app.get("/track-parcel-info/:id", verifyToken, async (req, res) => {
            try {
                const tracingId = req.params.id;
                const result = await parcelCollection.findOne({ tracingId: tracingId });
                if (!result) return res.status(404).send({ message: "Parcel not found" });
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

        app.get("/tracking/:id", async (req, res) => {
            try {
                const tracingId = req.params.id;
                const result = await trackingCollection.find({ tracingId: tracingId }).sort({ time: -1 }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

    } finally {
        // Keeping connection open
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("DakBox Server is running..."));
app.listen(port, () => console.log(`Server running on port: ${port}`));