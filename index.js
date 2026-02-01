const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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
    await client.connect();
    
    const db = client.db("dakBoxDB");
    const parcelCollection = db.collection("parcels");

    // POST: Save a new parcel
    app.post('/parcels', async (req, res) => {
      try {
        const parcel = req.body;
        
        if (!parcel) {
          return res.status(400).send({ message: "No data received" });
        }

        // Log to see incoming data in terminal
        console.log("New Parcel Received:", parcel);

        const result = await parcelCollection.insertOne(parcel);
        res.send(result);
      } catch (error) {
        console.error("Insert Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // GET: Fetch parcels by user email (Specific Important Fields)
app.get('/my-parcels/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const query = { userEmail: email };
        
        // স্ক্রিনশটে থাকা সব ইনফো সহ ডেটা নিয়ে আসা হচ্ছে
        const result = await parcelCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        console.error("Fetch Error:", error);
        res.status(500).send({ message: "Error fetching user parcels" });
    }
});




    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Connection Error Details:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('DakBox Server is running...');
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});