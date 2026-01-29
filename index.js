const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    // await client.connect();
    
    const parcelCollection = client.db("dakBoxDB").collection("parcels");

    // পার্সেল সেভ করার API
    app.post('/parcels', async (req, res) => {
      const parcel = req.body;
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Keep connection open
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('DakBox Server is running...');
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});