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
app.use(cors({origin: [
    "http://localhost:5173", 
    "https://dakbox-1f519.firebaseapp.com",
    "https://dakbox-1f519.web.app/"
  ],
  credentials: true
}));

app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');

// Firebase Admin Setup
const serviceAccount = JSON.parse(decodedKey);

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
    const rivewCollection = db.collection("reviews");
    const riderCashCollection = db.collection("cashouts");


    // --- Authentication Middlewares ---
    const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        console.log("No Header Found"); 
        return res.status(401).send({ message: "Unauthorized access" });
    }
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.log("JWT Verify Error:", err.message); 
            return res.status(401).send({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
    });
};

    // Middlewares

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: { $regex: new RegExp(`^${email}$`, "i") } }; // Case insensitive check
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyRider = async (req, res, next) => {
    const email = req.decoded.email;
    
    // Case insensitive regex check
    const query = { email: { $regex: new RegExp(`^${email}$`, "i") } };
    
    const user = await usersCollection.findOne(query);

    if (user?.role !== "rider") {
        return res
            .status(403)
            .send({ message: "Forbidden: Only riders can update status" });
    }
    next();
};

    // --- JWT API ---
    app.post("/jwt", async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "90d",
    });

   
    const query = { email: { $regex: new RegExp(`^${user.email}$`, "i") } };
    const dbUser = await usersCollection.findOne(query);

  
    res.send({ token, role: dbUser?.role || "user" });
});

    // --- User APIs ---
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const email = user.email;
        const userExist = await usersCollection.findOne({ email: email });
        if (userExist) {
          return res
            .status(200)
            .send({ message: "User already exists", inserted: false });
        }
        const result = await usersCollection.insertOne(user);
        res.status(201).send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.get("/user-role", verifyToken, async (req, res) => {
    try {
        const emailFromQuery = req.query.email?.toLowerCase().trim();
        const emailFromToken = req.decoded.email?.toLowerCase().trim();

        if (emailFromToken !== emailFromQuery) {
            return res.status(403).send({ message: "Forbidden access" });
        }

        const query = { email: { $regex: new RegExp(`^${emailFromQuery}$`, "i") } };
        const user = await usersCollection.findOne(query);
        res.send({ role: user?.role || "user" });
    } catch (err) {
        res.status(500).send({ message: "Server error" });
    }
});

    //  Admin APIs
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
        res
          .status(500)
          .send({ message: "Error fetching users", error: error.message });
      }
    });

    app.patch(
      "/users/make-admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      },
    );

    // Rider Application Routes
    app.post("/rider-applications", verifyToken, async (req, res) => {
      try {
        const application = req.body;
        const query = { email: application.email };
        const exist = await riderApplicationCollection.findOne(query);
        if (exist) {
          return res
            .status(400)
            .send({ message: "Application already submitted!" });
        }
        const result = await riderApplicationCollection.insertOne(application);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Server Error", error: error.message });
      }
    });

    app.get(
      "/rider-applications",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 10;
          const skip = (page - 1) * limit;
          const query = { status: { $ne: "pending" } };

          const totalCount =
            await riderApplicationCollection.countDocuments(query);
          const result = await riderApplicationCollection
            .find(query)
            .skip(skip)
            .limit(limit)
            .toArray();

          res.send({ result, totalCount });
        } catch (error) {
          console.error("Fetch Riders Error:", error);
          res.status(500).send({ message: "Error fetching riders" });
        }
      },
    );

    app.patch(
      "/rider-applications/approve/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const application = await riderApplicationCollection.findOne(query);
          if (!application) {
            return res
              .status(404)
              .send({ success: false, message: "Application not found!" });
          }
          const targetEmail = application.email;
          const appUpdate = await riderApplicationCollection.updateOne(query, {
            $set: { status: "active" },
          });
          let userUpdateResult = { modifiedCount: 0 };
          if (appUpdate.modifiedCount > 0) {
            userUpdateResult = await usersCollection.updateOne(
              { email: targetEmail },
              { $set: { role: "rider" } },
            );
          }
          res.send({
            success: true,
            message: `Approved! User ${targetEmail} is now a rider.`,
            appModified: appUpdate.modifiedCount,
            userModified: userUpdateResult.modifiedCount,
          });
        } catch (error) {
          res.status(500).send({
            success: false,
            message: "Server Error",
            error: error.message,
          });
        }
      },
    );

    app.patch(
      "/rider-applications/toggle-status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { currentStatus } = req.body;
          const newStatus = currentStatus === "active" ? "penalty" : "active";
          const result = await riderApplicationCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: newStatus } },
          );
          res.send({ success: true, newStatus });
        } catch (error) {
          res.status(500).send({ message: "Toggle failed" });
        }
      },
    );

    app.delete("/rider-applications/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const application = await riderApplicationCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!application) return res.status(404).send({ message: "Not found" });
        const deleteResult = await riderApplicationCollection.deleteOne({
          _id: new ObjectId(id),
        });
        await usersCollection.updateOne(
          { email: application.email },
          { $set: { role: "user" } },
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
      if (email !== req.decoded.email)
        return res.status(403).send({ message: "Forbidden access" });
      const result = await parcelCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });

    app.get("/parcel/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: "Invalid ID" });
      const result = await parcelCollection.findOne({
        _id: new ObjectId(id),
        userEmail: req.decoded.email,
      });
      res.send(result);
    });

    app.delete("/parcels/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const parcel = await parcelCollection.findOne(query);
      if (parcel?.status !== "pending")
        return res.status(400).send({ message: "Cannot cancel!" });
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
        if (!parcel)
          return res
            .status(404)
            .send({ success: false, message: "Parcel not found" });

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
            message:
              "Your payment is successful. Parcel is ready for processing.",
            time: new Date(),
          };
          await trackingCollection.insertOne(initialTracking);
          res.send({ success: true, message: "Payment recorded successfully" });
        } else {
          res.send({
            success: false,
            message: "Failed to update parcel status",
          });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    app.get("/payment-history", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.decoded.email)
          return res.status(403).send({ message: "Forbidden access" });
        const result = await paymentsCollection
          .find({ userEmail: email })
          .sort({ paymentDate: -1 })
          .toArray();
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
        if (!result)
          return res.status(404).send({ message: "Parcel not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/tracking/:id", async (req, res) => {
      try {
        const tracingId = req.params.id;
        const result = await trackingCollection
          .find({ tracingId: tracingId })
          .sort({ time: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // Admin Assigning Rider
    app.patch(
      "/admin/assign-rider/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { riderEmail, riderName, approximateDeliveryDate } = req.body;
        const filter = { _id: new ObjectId(id) };
        const parcel = await parcelCollection.findOne(filter);
        if (!parcel)
          return res.status(404).send({ message: "Parcel not found" });

        const updateDoc = {
          $set: {
            status: "assigned",
            riderEmail,
            riderName,
            approximateDeliveryDate,
            assignedTime: new Date(),
          },
        };

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          const trackingLog = {
            tracingId: parcel.tracingId,
            status: "Rider Assigned",
            message: `Parcel assigned to ${riderName}. Expected delivery: ${approximateDeliveryDate}`,
            time: new Date(),
          };
          await trackingCollection.insertOne(trackingLog);

          res.send({
            success: true,
            message: "Rider assigned and tracking updated",
          });
        } else {
          res.status(500).send({ success: false, message: "Update failed" });
        }
      },
    );

    // Rider Status Update API
    app.patch(
      "/parcels/update-status/:id",
      verifyToken,
      verifyRider,
      async (req, res) => {
        const id = req.params.id;
        const { status, message } = req.body;
        const filter = { _id: new ObjectId(id) };

        try {
          const parcel = await parcelCollection.findOne(filter);
          if (!parcel)
            return res.status(404).send({ message: "Parcel not found" });

          let updateDoc = { $set: { status: status } };
          if (status === "delivered") {
            const isOutRange =
              parcel.senderDistrict !== parcel.receiverDistrict;
            const commissionRate = isOutRange ? 0.2 : 0.12;
            const riderEarnings = parcel.totalCharge * commissionRate;
            const adminEarnings = parcel.totalCharge - riderEarnings;

            updateDoc.$set = {
              ...updateDoc.$set,
              deliveredDate: new Date().toISOString(),
              riderCommission: riderEarnings,
              adminCommission: adminEarnings,
              isCashedOut: false,
            };
          }
          const result = await parcelCollection.updateOne(filter, updateDoc);

          if (result.modifiedCount > 0) {
            const trackingLog = {
              tracingId: parcel.tracingId,
              status: status,
              message: message || `Parcel is now ${status}`,
              time: new Date(),
            };
            await trackingCollection.insertOne(trackingLog);

            res.send({
              success: true,
              message: `Status updated to ${status} and earnings calculated!`,
            });
          } else {
            res
              .status(500)
              .send({ success: false, message: "Failed to update status" });
          }
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      },
    );
    // with pagination,Parcel Getting
    app.get(
      "/admin/all-parcels",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        const totalCount = await parcelCollection.estimatedDocumentCount();
        const result = await parcelCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ result, totalCount });
      },
    );

    // 2. All riders list
    app.get(
      "/users/riders-list",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const query = { role: "rider" };
        const result = await usersCollection.find(query).toArray();
        res.send(result);
      },
    );

    // riders-delivery get api

    app.get(
      "/rider/my-deliveries/:email",
      verifyToken,
      verifyRider,
      async (req, res) => {
        const email = req.params.email;

        if (req.decoded.email !== email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
        const query = { riderEmail: email };
        const result = await parcelCollection.find(query).toArray();
        res.send(result);
      },
    );

    app.patch("/parcel/update-status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status: status } };
      const result = await parcelCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // --- Cashout-Riders API ---

    // 1.cashout save
    app.post(
      "/cashout-requests",
      verifyToken,
      verifyRider,
      async (req, res) => {
        const request = req.body;
        if (request.amount < 500) {
          return res.status(400).send({ message: "Minimum 500 BDT required" });
        }

        const result = await riderCashCollection.insertOne({
          ...request,
          status: "pending",
          requestDate: new Date(),
        });
        res.send(result);
      },
    );

    // 2.fixed rider's cashout history
    app.get(
      "/my-cashouts/:email",
      verifyToken,
      verifyRider,
      async (req, res) => {
        const email = req.params.email;
        const result = await riderCashCollection
          .find({ riderEmail: email })
          .sort({ requestDate: -1 })
          .toArray();
        res.send(result);
      },
    );

    // --- Admin Cashout Management ---

    // 1.Admin will see every req
    app.get(
      "/admin/cashout-requests",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await riderCashCollection
          .find()
          .sort({ requestDate: -1 })
          .toArray();
        res.send(result);
      },
    );

    // 2.Admin approve req
    app.patch(
      "/admin/approve-cashout/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const cashoutReq = await riderCashCollection.findOne(filter);
        if (!cashoutReq)
          return res.status(404).send({ message: "Request not found" });

        const updateResult = await riderCashCollection.updateOne(filter, {
          $set: { status: "success", approvedDate: new Date() },
        });

        if (updateResult.modifiedCount > 0) {
          await parcelCollection.updateMany(
            {
              riderEmail: cashoutReq.riderEmail,
              status: "delivered",
              isCashedOut: false,
            },
            { $set: { isCashedOut: true } },
          );
          res.send({ success: true, message: "Cashout approved successfully" });
        } else {
          res.status(500).send({ message: "Failed to approve" });
        }
      },
    );

    // rivew api

    // 1. user's review save ap[i]
    app.post("/reviews", verifyToken, async (req, res) => {
      try {
        const review = req.body;
        const result = await rivewCollection.insertOne(review);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Review failed to save" });
      }
    });

    // 2. rider can see own review (Rider's Review API)
    app.get("/rider-reviews/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        const decodedEmail = req.decoded.email;
        const requester = await usersCollection.findOne({
          email: decodedEmail,
        });
        const isAdmin = requester?.role === "admin";
        if (decodedEmail !== email && !isAdmin) {
          return res
            .status(403)
            .send({ message: "Forbidden Access: Access Denied!" });
        }

        const result = await rivewCollection
          .find({ riderEmail: email })
          .sort({ date: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Review Fetch Error:", error);
        res.status(500).send({ message: "Error fetching reviews" });
      }
    });

    // 3. avg rating of rider
    app.get("/rider-stats/:email", async (req, res) => {
      const email = req.params.email;
      const reviews = await rivewCollection
        .find({ riderEmail: email })
        .toArray();
      const totalReviews = reviews.length;

      const avgRating =
        totalReviews > 0
          ? (
              reviews.reduce(
                (acc, curr) => acc + (parseFloat(curr.rating) || 0),
                0,
              ) / totalReviews
            ).toFixed(1)
          : 0;

      res.send({ avgRating, totalReviews });
    });

    // --- Admin Aggregated Dashboard API ---
    app.get(
      "/admin/dashboard-stats",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          // 1. Basic Count & total Income (Card Stats)
          const totalParcels = await parcelCollection.estimatedDocumentCount();
          const totalUsers = await usersCollection.countDocuments();

          const revenueResult = await paymentsCollection
            .aggregate([
              { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
            ])
            .toArray();
          const totalRevenue = revenueResult[0]?.totalRevenue || 0;

          // 2. Every Day booking trend
          const bookingTrends = await parcelCollection
            .aggregate([
              {
                $group: {
                  _id: { $substr: ["$bookingDate", 0, 10] },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
              { $limit: 15 },
              { $project: { date: "$_id", parcels: "$count", _id: 0 } },
            ])
            .toArray();

          // 3. Districwise distribution
          const districtStats = await parcelCollection
            .aggregate([
              {
                $group: {
                  _id: "$receiverDistrict",
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 8 },
              { $project: { district: "$_id", total: "$count", _id: 0 } },
            ])
            .toArray();

          // 4. Parcel status breakdown Databnase
          const statusStats = await parcelCollection
            .aggregate([
              {
                $group: {
                  _id: "$status",
                  value: { $sum: 1 },
                },
              },
              { $project: { name: "$_id", value: 1, _id: 0 } },
            ])
            .toArray();

          res.send({
            cards: {
              totalParcels,
              totalUsers,
              totalRevenue,
            },
            bookingTrends,
            districtStats,
            statusStats,
          });
        } catch (error) {
          console.error("Dashboard Stats Error:", error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      },
    );
  } finally {
    // Keeping connection open
  }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("DakBox Server is running..."));
app.listen(port, () => console.log(`Server running on port: ${port}`));
module.exports = app; 
//comment following commandsawait client.db("admin").command({ ping: 1 });