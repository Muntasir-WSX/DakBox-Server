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
    // await client.connect(); 
    
    const db = client.db("dakBoxDB");
    const parcelCollection = db.collection("parcels");

    // --- API Routes ---

    // ১. POST: new parcel 
    app.post('/parcels', async (req, res) => {
      try {
        const parcel = req.body;
        if (!parcel) return res.status(400).send({ message: "Bad Request: No data" });
        
        const result = await parcelCollection.insertOne(parcel);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    // ২. GET: parcel by user email
    app.get('/my-parcels/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const query = { userEmail: email };
        const result = await parcelCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching user parcels" });
      }
    });

    // ৩. GET: parcel details by ID
    app.get('/parcel/:id', async (req, res) => {
      try {
        const id = req.params.id;
        
       // id validation checking
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }

        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.findOne(query);
        
        if (!result) return res.status(404).send({ message: "Parcel not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error fetching details" });
      }
    });

    // ৪. DELETE: parcel delete (pending status only)
    app.delete('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

        const query = { _id: new ObjectId(id) };
        
        // checik parcel status before deletion
        const parcel = await parcelCollection.findOne(query);
        
        if (!parcel) return res.status(404).send({ message: "Parcel not found" });

        if (parcel.status !== 'pending') {
          return res.status(400).send({ message: "Cannot cancel! Parcel is already " + parcel.status });
        }

        const result = await parcelCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Delete operation failed" });
      }
    });

    console.log("Connected to MongoDB successfully!");
  } finally {
    
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('DakBox Server is humming along...');
});

app.listen(port, () => {
  console.log(` Server is flying on port: ${port}`);
});