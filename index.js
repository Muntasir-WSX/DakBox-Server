const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@simple-crud-server.a0arf8b.mongodb.net/?appName=simple-crud-server`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // await client.connect(); 
        console.log("Database connected!");

        const db = client.db("dakBoxDB");
        const parcelCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");

        // 1. POST: new parcel 
        app.post('/parcels', async (req, res) => {
            try {
                const parcel = req.body;
                const result = await parcelCollection.insertOne(parcel);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error", error: error.message });
            }
        });

        // 2. GET: parcel by user email
        app.get('/my-parcels/:email', async (req, res) => {
            const email = req.params.email;
            const query = { userEmail: email };
            const result = await parcelCollection.find(query).toArray();
            res.send(result);
        });

        // 3. GET: parcel details by ID
        app.get('/parcel/:id', async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
            const query = { _id: new ObjectId(id) };
            const result = await parcelCollection.findOne(query);
            res.send(result);
        });

        // 4. DELETE: parcel delete
        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const parcel = await parcelCollection.findOne(query);
            if (parcel?.status !== 'pending') {
                return res.status(400).send({ message: "Cannot cancel! Already " + parcel.status });
            }
            const result = await parcelCollection.deleteOne(query);
            res.send(result);
        });

        // 5. Create Payment Intent
        app.post('/create-payment-intent', async (req, res) => {
            try {
                const { price } = req.body;
                if (!price || price < 1) return res.status(400).send({ message: "Invalid price" });
                const amount = Math.round(price * 100);

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'bdt', 
                    payment_method_types: ['card']
                });
                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });

        // 6. Payment Success Update
        app.patch('/parcel/payment-success/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const paymentInfo = req.body;
                const filter = { _id: new ObjectId(id) };

                const parcel = await parcelCollection.findOne(filter);
                if (!parcel) return res.status(404).send({ message: "Parcel not found" });

                // (Data structure correct and validation can be added here)
                const paymentRecord = {
                    parcelId: id,
                    transactionId: paymentInfo.transactionId,
                    userEmail: parcel.userEmail,
                    userName: parcel.userName,
                    amount: parcel.totalCharge,
                    parcelType: parcel.parcelType,
                    paymentDate: new Date()
                };
                const insertResult = await paymentsCollection.insertOne(paymentRecord);
                const updatedDoc = {
                    $set: {
                        status: 'paid',
                        transactionId: paymentInfo.transactionId,
                        paymentDate: new Date()
                    }
                };
                const updateResult = await parcelCollection.updateOne(filter, updatedDoc);

                res.send({ 
                    success: true, 
                    updateResult, 
                    insertResult 
                });
            } catch (error) {
                res.status(500).send({ message: "Database update failed", error: error.message });
            }
        });

        // 7. GET: Payment History
        app.get('/payment-history', async (req, res) => {
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

app.get('/', (req, res) => {
    res.send('DakBox Server is humming along...');
});

app.listen(port, () => {
    console.log(`Server is flying on port: ${port}`);
});