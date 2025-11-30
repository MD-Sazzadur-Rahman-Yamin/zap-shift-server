const express = require("express");
const cors = require("cors");
require("dotenv").config();
// import { generateTrackingId } from "./utility/trackingIdGenerator.js";
const { generateTrackingId } = require("./utility/trackingIdGenerator.js");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3333;

const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift-yamin-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middlewere
app.use(express.json());
app.use(cors());
const varifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorize access" });
  }
  try {
    const idtoken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idtoken);
    req.decoded_email = decoded.email;
    next();
  } catch {
    return res.status(401).send({ message: "Unauthorize access" });
  }
};

//mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.zzj1wzu.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("zap-shift-db");
    const usersColl = db.collection("users");
    const parcelsColl = db.collection("parcels");
    const paymentColl = db.collection("payments");
    const ridersColl = db.collection("riders");

    //users API
    app.get("/users", varifyFBToken, async (req, res) => {
      const cursor = usersColl.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {});

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersColl.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createAt = new Date();

      const email = user.email;
      const isUserExist = await usersColl.findOne({ email });

      if (isUserExist) {
        return res.send({ message: "User Exist" });
      }

      const result = await usersColl.insertOne(user);
      res.send(result);
    });

    app.patch("/users/:id/role", async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDocs = {
        $set: {
          role: roleInfo.role,
        },
      };
      const result = await usersColl.updateOne(query, updatedDocs);
      res.send(result);
    });

    //riders API
    app.get("/riders", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = ridersColl.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createAt = new Date();

      const result = await ridersColl.insertOne(rider);
      res.send(result);
    });
    app.patch("/riders/:id", async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDocs = {
        $set: {
          status: status,
        },
      };
      const result = await ridersColl.updateOne(query, updatedDocs);
      if (status === "approved") {
        const email = req.body.email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "rider",
          },
        };
        const userResult = await usersColl.updateOne(userQuery, updateUser);
      }
      res.send(result);
    });

    //parcel API
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const option = { sort: { createAt: -1 } };
      const cursor = parcelsColl.find(query, option);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsColl.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createAt = new Date();
      const result = await parcelsColl.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = parcelsColl.deleteOne(query);
      res.send(result);
    });

    //payment releted APIs

    app.get("/payments", varifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded_email) {
        return res.status(403).send("forbidden access");
      }
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const cursor = paymentColl.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const trackingId = generateTrackingId();

      const transactionID = session.payment_intent;
      const query = { transactionId: transactionID };
      const paymentExist = await paymentColl.findOne(query);
      if (paymentExist) {
        return res.send({
          message: "payment exist",
          transactionId: transactionID,
          trackingId: paymentExist.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: { paymentStatus: "paid", trackingId: trackingId },
        };

        const result = await parcelsColl.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentColl.insertOne(payment);
          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
            trackingId: trackingId,
            transactionId: session.payment_intent,
          });
        }
      }

      res.send({ success: false });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
