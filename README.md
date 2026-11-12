# Partwise

A responsive phone spare-parts business system built with plain HTML, CSS, JavaScript modules, Firebase Authentication, and Cloud Firestore.

## Run the demo

Serve this folder over HTTP. For example, with Python installed:

```powershell
py -m http.server 8000
```

Open `http://localhost:8000`. ES modules and Firebase require an HTTP origin; opening `index.html` directly as a file is not supported. With the provided Firebase config, the site connects to the Firebase project. The local sample-data demo is used only when the config contains placeholders.

## Deploy with Firebase Hosting

The project is bound to Firebase project `spairparts-b58f5` in `.firebaserc`. From this folder, run:

```powershell
npx --yes firebase-tools login
npx --yes firebase-tools deploy --only hosting,firestore:rules
```

The first command opens Firebase's sign-in flow. The second deploys the static site and the rules configured in `firebase.json`. Firebase Hosting will provide the site's `web.app` and `firebaseapp.com` URLs. In Firebase Authentication settings, make sure the Hosting domain is listed under **Authorized domains**.

## Connect Firebase

1. In Firebase Authentication, enable Email/Password and Google sign-in.
2. Add the domain used to serve the site to Authentication's authorized domains. For local testing, add `localhost` if it is not already present.
3. Create a Cloud Firestore database and publish `firestore.rules`.
4. The web app settings supplied for this project are in `firebase-config.js`.
5. A new customer can register from the Customer tab using email/password or Google; Google sign-in creates their Firebase account on first use. New accounts are customers by default.
6. To create the first admin account, select the Admin tab and choose **New admin? Create an admin account**. After registration, copy the new account's UID from Firebase Authentication.
7. For this first administrator only, create `adminUsers/{UID}` in Firestore Console with fields `role: "admin"`, `addedAt` (number), and `addedBy` (the same UID). Admin registration creates the account but deliberately does not grant privileges until this one-time bootstrap is complete.
8. Sign in through the Admin tab. To add later administrators, have each teammate create an account through either tab, then use **Team access** in the admin dashboard and choose **Make admin** beside their account.

The app uses shared top-level `products`, `sales`, `interests`, `profiles`, `adminUsers`, and admin-only `productCosts` collections. Any signed-in account can browse products; only accounts listed in `adminUsers` can manage stock, record sales, or review requests. Internal product cost is stored separately so customers cannot read it. Customers can create interest requests and read only their own requests. Firebase web configuration is public client configuration, not a secret; access control is enforced by Authentication and Firestore rules. Do not loosen the rules for production.

## Included workflows

- Add and edit parts with SKU, category, cost, sale price, stock, and minimum stock.
- Admin dashboard with searchable inventory, restock alerts, sales totals, and transaction history.
- Customer catalog with part search, stock availability, and interest requests.
- Admin review of customer requests with approve/decline status.
- Separate Customer and Admin sign-in modes and an admin-managed team access screen.
- Customers must register before an admin can promote their account; later admin additions do not require Firebase Console access.
- Atomic sale recording that deducts stock using a Firestore transaction.
- Email/password and Google account sign-in.
