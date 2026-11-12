import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, getDocs, getFirestore, query, runTransaction, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

const sampleProducts = [
  { id: "sample-screen", name: "iPhone 13 OLED display", sku: "IP13-DSP-OLED", category: "Displays", stock: 7, cost: 46, price: 89, minStock: 4 },
  { id: "sample-battery", name: "Galaxy S22 battery", sku: "GS22-BAT-01", category: "Batteries", stock: 3, cost: 18, price: 39, minStock: 4 },
  { id: "sample-port", name: "USB-C charging port flex", sku: "USBC-FLX-02", category: "Charging", stock: 12, cost: 7.5, price: 22, minStock: 5 },
  { id: "sample-camera", name: "iPhone 12 rear camera", sku: "IP12-CAM-R", category: "Small parts", stock: 2, cost: 24, price: 55, minStock: 3 },
  { id: "sample-tools", name: "Precision driver set", sku: "TOOL-DRV-09", category: "Tools", stock: 9, cost: 12, price: 28, minStock: 2 }
];
const $ = (selector) => document.querySelector(selector);
const refs = {
  appShell: $("#appShell"), landingPage: $("#landingPage"), inventoryRows: $("#inventoryRows"), inventoryEmpty: $("#inventoryEmpty"),
  salesRows: $("#salesRows"), salesEmpty: $("#salesEmpty"), inventorySearch: $("#inventorySearch"), categoryFilter: $("#categoryFilter"),
  salesSearch: $("#salesSearch"), productDialog: $("#productDialog"), productForm: $("#productForm"), saleDialog: $("#saleDialog"),
  saleForm: $("#saleForm"), saleProductSelect: $("#saleProductSelect"), saleUnitPrice: $("#saleUnitPrice"), saleTotal: $("#saleTotal"),
  interestDialog: $("#interestDialog"), interestForm: $("#interestForm"), catalog: $("#customerCatalog"), toast: $("#toast")
};
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const dateTime = (value) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const useFirebase = Object.values(firebaseConfig).every((value) => typeof value === "string" && value && !value.startsWith("YOUR_"));
let products = [];
let sales = [];
let interests = [];
let profiles = [];
let currentUser = null;
let currentRole = "";
let selectedAuthRole = "customer";
let creatingAccount = false;
let pendingAdminRegistration = false;
let toastTimer;
let db;
let auth;

function showToast(message, isError = false) {
  refs.toast.textContent = message;
  refs.toast.classList.toggle("error", isError);
  refs.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove("show"), 3200);
}
function lowStock(product) { return Number(product.stock) <= Number(product.minStock); }
function partInitials(name) { return String(name || "P").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(); }

async function loadCloudData() {
  const productSnapshot = await getDocs(collection(db, "products"));
  if (currentRole === "admin") {
    const [costSnapshot, saleSnapshot, interestSnapshot, profileSnapshot, adminSnapshot] = await Promise.all([
      getDocs(collection(db, "productCosts")), getDocs(collection(db, "sales")), getDocs(collection(db, "interests")),
      getDocs(collection(db, "profiles")), getDocs(collection(db, "adminUsers"))
    ]);
    const costs = new Map(costSnapshot.docs.map((entry) => [entry.id, entry.data().cost]));
    const admins = new Set(adminSnapshot.docs.map((entry) => entry.id));
    products = productSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data(), cost: Number(costs.get(entry.id) || 0) }));
    sales = saleSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    interests = interestSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    profiles = profileSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data(), isAdmin: admins.has(entry.id) }));
  } else {
    products = productSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data(), cost: 0 }));
    sales = [];
    profiles = [];
    const requestSnapshot = await getDocs(query(collection(db, "interests"), where("customerId", "==", currentUser.uid)));
    interests = requestSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  }
}
function render() {
  if (currentRole === "admin") renderAdmin();
  if (currentRole === "customer") { renderCatalog(); renderCustomerRequests(); }
}
function renderAdmin() {
  const today = new Date().toDateString();
  const todaySales = sales.filter((sale) => new Date(sale.createdAt).toDateString() === today);
  const lowProducts = products.filter(lowStock);
  $("#inventoryValue").textContent = money(products.reduce((sum, product) => sum + Number(product.stock) * Number(product.cost), 0));
  $("#productCount").textContent = String(products.length);
  $("#lowStockCount").textContent = String(lowProducts.length);
  $("#todaySales").textContent = money(todaySales.reduce((sum, sale) => sum + Number(sale.total), 0));
  $("#todaySaleCount").textContent = `${todaySales.length} transaction${todaySales.length === 1 ? "" : "s"} today`;
  $("#navStockCount").textContent = String(products.length);
  $("#navInterestCount").textContent = String(interests.filter((request) => request.status === "pending").length);
  $("#allTimeSales").textContent = money(sales.reduce((sum, sale) => sum + Number(sale.total), 0));
  $("#allTimeTransactions").textContent = String(sales.length);
  $("#unitsMoved").textContent = String(sales.reduce((sum, sale) => sum + Number(sale.quantity), 0));
  $("#resultCount").textContent = `${products.length} part${products.length === 1 ? "" : "s"}`;
  renderInventory(); renderOverviewLists(lowProducts); renderSales(); renderSaleOptions(); renderAdminInterests(); renderTeam();
}
function renderInventory() {
  const queryText = refs.inventorySearch.value.trim().toLowerCase();
  const category = refs.categoryFilter.value;
  const visible = products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(queryText) && (!category || product.category === category)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  refs.inventoryRows.innerHTML = visible.map((product) => `<tr><td><div class="part-cell"><span class="part-thumb">${escapeHTML(partInitials(product.name))}</span><span><strong>${escapeHTML(product.name)}</strong><small>Cost ${money(product.cost)} · Min ${Number(product.minStock)}</small></span></div></td><td><span class="sku-text">${escapeHTML(product.sku)}</span></td><td>${escapeHTML(product.category)}</td><td><span class="stock-number">${Number(product.stock)}</span></td><td>${money(product.price)}</td><td><span class="status-pill ${lowStock(product) ? "low" : ""}">${lowStock(product) ? "Restock" : "In stock"}</span></td><td><div class="row-actions"><button class="row-action" data-action="sell" data-id="${escapeHTML(product.id)}" aria-label="Record sale for ${escapeHTML(product.name)}" title="Record sale">↗</button><button class="row-action" data-action="edit" data-id="${escapeHTML(product.id)}" aria-label="Edit ${escapeHTML(product.name)}" title="Edit part">✎</button></div></td></tr>`).join("");
  refs.inventoryEmpty.hidden = visible.length > 0;
}
function renderOverviewLists(lowProducts) {
  const lowMarkup = lowProducts.slice(0, 4).map((product, index) => `<div class="list-row"><span class="part-thumb ${index % 2 ? "orange" : ""}">${escapeHTML(partInitials(product.name))}</span><span class="list-row-copy"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.sku)}</small></span><span class="list-row-end stock-warning">${Number(product.stock)} left</span></div>`).join("");
  $("#lowStockList").innerHTML = lowMarkup || `<div class="list-empty">Everything is above its restock point.</div>`;
  const recent = [...sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  $("#recentSalesList").innerHTML = recent.map((sale, index) => `<div class="list-row"><span class="part-thumb ${index % 2 ? "blue" : ""}">${escapeHTML(partInitials(sale.productName))}</span><span class="list-row-copy"><strong>${escapeHTML(sale.productName)}</strong><small>${dateTime(sale.createdAt)}</small></span><span class="list-row-end">${money(sale.total)}</span></div>`).join("") || `<div class="list-empty">Sales you record will appear here.</div>`;
}
function renderSales() {
  const queryText = refs.salesSearch.value.trim().toLowerCase();
  const visible = [...sales].filter((sale) => `${sale.productName} ${sale.sku || ""}`.toLowerCase().includes(queryText)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  refs.salesRows.innerHTML = visible.map((sale) => `<tr><td><div class="part-cell"><span class="part-thumb">${escapeHTML(partInitials(sale.productName))}</span><span><strong>${escapeHTML(sale.productName)}</strong><small>${escapeHTML(sale.sku || "")}</small></span></div></td><td>${dateTime(sale.createdAt)}</td><td>${Number(sale.quantity)}</td><td>${money(sale.unitPrice)}</td><td><strong>${money(sale.total)}</strong></td></tr>`).join("");
  refs.salesEmpty.hidden = visible.length > 0;
}
function renderAdminInterests() {
  const sorted = [...interests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#adminInterestRows").innerHTML = sorted.map((request) => `<tr><td><div class="part-cell"><span class="part-thumb">${escapeHTML(partInitials(request.productName))}</span><span><strong>${escapeHTML(request.productName)}</strong><small>${escapeHTML(request.sku || "")}</small></span></div></td><td>${escapeHTML(request.customerEmail || "Customer")}</td><td>${Number(request.quantity)}</td><td><span class="interest-note" title="${escapeHTML(request.message || "No note")}">${escapeHTML(request.message || "No note")}</span></td><td>${dateTime(request.createdAt)}</td><td><span class="request-status ${escapeHTML(request.status)}">${escapeHTML(request.status)}</span></td><td>${request.status === "pending" ? `<div class="interest-action"><button class="button button-primary" data-interest-status="approved" data-id="${escapeHTML(request.id)}">Approve</button><button class="button button-quiet" data-interest-status="declined" data-id="${escapeHTML(request.id)}">Decline</button></div>` : ""}</td></tr>`).join("");
  $("#adminInterestEmpty").hidden = sorted.length > 0;
}
function renderTeam() {
  const sorted = [...profiles].sort((a, b) => String(a.email || a.displayName).localeCompare(String(b.email || b.displayName)));
  $("#teamRows").innerHTML = sorted.map((profile) => `<tr><td><span class="team-email">${escapeHTML(profile.displayName || profile.email || "Registered account")}</span><br><span class="sku-text">${escapeHTML(profile.email || "No email address")}</span></td><td><span class="team-uid" title="${escapeHTML(profile.id)}">${escapeHTML(profile.id)}</span></td><td><span class="team-role ${profile.isAdmin ? "admin" : ""}">${profile.isAdmin ? "Administrator" : "Customer"}</span></td><td>${profile.isAdmin ? "" : `<button class="button button-primary team-promote" data-promote-admin="${escapeHTML(profile.id)}">Make admin</button>`}</td></tr>`).join("");
  $("#teamEmpty").hidden = sorted.length > 0;
}
function renderCatalog() {
  const search = $("#catalogSearch").value.trim().toLowerCase();
  const category = $("#catalogCategory").value;
  const visible = products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(search) && (!category || product.category === category)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  refs.catalog.innerHTML = visible.map((product, index) => `<article class="catalog-card"><div class="catalog-card-top"><span class="part-thumb ${index % 3 === 1 ? "orange" : index % 3 === 2 ? "blue" : ""}">${escapeHTML(partInitials(product.name))}</span><span class="catalog-category">${escapeHTML(product.category)}</span></div><h2>${escapeHTML(product.name)}</h2><span class="catalog-sku">SKU ${escapeHTML(product.sku)}</span><div class="catalog-card-bottom"><div><strong class="catalog-price">${money(product.price)}</strong><span class="catalog-availability">${Number(product.stock) > 0 ? `${Number(product.stock)} in stock` : "Currently unavailable"}</span></div><button class="button button-primary" data-action="request" data-id="${escapeHTML(product.id)}">I'm interested</button></div></article>`).join("");
  $("#catalogEmpty").hidden = visible.length > 0;
}
function renderCustomerRequests() {
  const sorted = [...interests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#customerRequestList").innerHTML = sorted.map((request) => `<article class="request-card"><div class="request-part"><span class="part-thumb">${escapeHTML(partInitials(request.productName))}</span><span><strong>${escapeHTML(request.productName)}</strong><small>SKU ${escapeHTML(request.sku || "")}</small></span></div><span class="request-quantity">${Number(request.quantity)} requested</span><span class="request-date">${dateTime(request.createdAt)}</span><span class="request-status ${escapeHTML(request.status)}">${escapeHTML(request.status)}</span></article>`).join("");
  $("#customerRequestEmpty").hidden = sorted.length > 0;
}
function renderSaleOptions() {
  const available = products.filter((product) => Number(product.stock) > 0);
  refs.saleProductSelect.innerHTML = available.map((product) => `<option value="${escapeHTML(product.id)}">${escapeHTML(product.name)} · ${Number(product.stock)} in stock</option>`).join("");
  refs.saleProductSelect.disabled = available.length === 0;
  refs.saleForm.querySelector('[type="submit"]').disabled = available.length === 0;
  updateSalePrice();
}
function updateSalePrice() {
  const product = products.find((entry) => entry.id === refs.saleProductSelect.value);
  if (product && !refs.saleUnitPrice.dataset.changed) refs.saleUnitPrice.value = Number(product.price).toFixed(2);
  const quantity = Number(refs.saleForm.elements.quantity.value) || 0;
  refs.saleTotal.textContent = money(quantity * Number(refs.saleUnitPrice.value));
  $("#saleStockHint").textContent = product ? `${Number(product.stock)} available. Stock will update when saved.` : "Add a part with stock before recording a sale.";
}
function setView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  const titles = { overviewView: "Overview", inventoryView: "Inventory", salesView: "Sales", interestsView: "Interest requests", teamView: "Team access", customerCatalogView: "Browse parts", customerRequestsView: "My requests" };
  $("#pageTitle").textContent = titles[viewId] || "Partwise";
}
function setRoleNavigation() {
  document.querySelectorAll("[data-role]").forEach((element) => { element.hidden = element.dataset.role !== currentRole; });
  $("#storageLabel").textContent = "Firebase connected";
  $("#accountLabel").textContent = "Sign out";
  $("#userLabel").textContent = currentUser?.email || "Google account";
  $(".sidebar-user strong").textContent = currentRole === "admin" ? "Shop administrator" : "Customer account";
  $("#overviewHeading").innerHTML = `Good morning, ${currentRole === "admin" ? "manager" : "shop"}<span class="heading-period">.</span>`;
  setView(currentRole === "admin" ? "overviewView" : "customerCatalogView");
}
function openProductDialog(product = null) {
  refs.productForm.reset();
  refs.productForm.elements.id.value = product?.id || "";
  refs.productForm.elements.name.value = product?.name || "";
  refs.productForm.elements.sku.value = product?.sku || "";
  refs.productForm.elements.category.value = product?.category || "";
  refs.productForm.elements.stock.value = product?.stock ?? 0;
  refs.productForm.elements.cost.value = product?.cost ?? "";
  refs.productForm.elements.price.value = product?.price ?? "";
  refs.productForm.elements.minStock.value = product?.minStock ?? 3;
  $("#productDialogTitle").textContent = product ? "Edit part" : "Add a part";
  $("#deleteProductButton").hidden = !product;
  refs.productDialog.showModal();
}
function openSaleDialog(productId = "") {
  refs.saleForm.reset();
  refs.saleUnitPrice.dataset.changed = "";
  renderSaleOptions();
  if (productId) refs.saleProductSelect.value = productId;
  updateSalePrice();
  refs.saleDialog.showModal();
}
function openInterestDialog(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product) return;
  refs.interestForm.reset();
  refs.interestForm.elements.productId.value = product.id;
  $("#interestProductName").textContent = `${product.name} · ${product.sku}`;
  refs.interestDialog.showModal();
}
async function saveProduct(product) {
  const id = product.id || crypto.randomUUID();
  const { id: ignoredId, cost, ...data } = product;
  const batch = writeBatch(db);
  batch.set(doc(db, "products", id), { ...data, updatedAt: Date.now() });
  batch.set(doc(db, "productCosts", id), { cost: Number(cost), updatedAt: Date.now() });
  await batch.commit();
}
async function recordSale(productId, quantity, unitPrice) {
  const product = products.find((entry) => entry.id === productId);
  if (!product || quantity < 1 || quantity > Number(product.stock)) throw new Error("Not enough stock available for that sale.");
  const productRef = doc(db, "products", productId);
  const saleRef = doc(collection(db, "sales"));
  await runTransaction(db, async (transaction) => {
    const productDoc = await transaction.get(productRef);
    if (!productDoc.exists()) throw new Error("This part no longer exists.");
    const latest = productDoc.data();
    if (quantity > Number(latest.stock)) throw new Error("Not enough stock available for that sale.");
    transaction.update(productRef, { stock: Number(latest.stock) - quantity, updatedAt: Date.now() });
    transaction.set(saleRef, { productId, productName: latest.name, sku: latest.sku, quantity, unitPrice, total: quantity * unitPrice, createdAt: Date.now(), customerId: currentUser.uid });
  });
}
async function sendInterest(productId, quantity, message) {
  const product = products.find((entry) => entry.id === productId);
  if (!product) throw new Error("This part is no longer available in the catalog.");
  await addDoc(collection(db, "interests"), { customerId: currentUser.uid, customerEmail: currentUser.email || "Google account", productId, productName: product.name, sku: product.sku, quantity, message, status: "pending", createdAt: Date.now() });
}
function authErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Email or password is incorrect.", "auth/email-already-in-use": "An account already exists for this email.",
    "auth/weak-password": "Use a password with at least 6 characters.", "auth/invalid-email": "Enter a valid email address.",
    "auth/unauthorized-domain": "Add this website's domain to Firebase Authentication's authorized domains.",
    "auth/popup-blocked": "Allow popups for this site and try Google sign-in again."
  };
  return messages[error.code] || error.message || "Something went wrong. Please try again.";
}
function selectAuthRole(role) {
  selectedAuthRole = role;
  creatingAccount = false;
  const isAdmin = role === "admin";
  $("#customerAuthTab").classList.toggle("active", !isAdmin);
  $("#customerAuthTab").setAttribute("aria-selected", String(!isAdmin));
  $("#adminAuthTab").classList.toggle("active", isAdmin);
  $("#adminAuthTab").setAttribute("aria-selected", String(isAdmin));
  $("#authHeading").textContent = isAdmin ? "Administrator sign in" : "Welcome back";
  $(".login-intro").textContent = isAdmin ? "Sign in with the same account you registered for admin access." : "Sign in to browse parts or create a customer account.";
  $("#authSubmit").textContent = "Sign in";
  $("#googleSignIn").lastChild.textContent = "Continue with Google";
  $("#authModeButton").hidden = false;
  $("#authModeButton").textContent = isAdmin ? "New admin? Create an admin account" : "New here? Create a customer account";
  $("#authError").textContent = "";
}
async function syncUserProfile(user) {
  const profileRef = doc(db, "profiles", user.uid);
  const profileSnapshot = await getDoc(profileRef);
  const existing = profileSnapshot.exists() ? profileSnapshot.data() : {};
  await setDoc(profileRef, {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || existing.displayName || user.email || "Registered account",
    createdAt: existing.createdAt || Date.now(),
    lastSeenAt: Date.now()
  }, { merge: true });
}

document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.goView)));
document.querySelectorAll("[data-open-sale]").forEach((button) => button.addEventListener("click", () => openSaleDialog()));
$("#addProductButton").addEventListener("click", () => openProductDialog());
refs.inventorySearch.addEventListener("input", renderInventory);
refs.categoryFilter.addEventListener("change", renderInventory);
refs.salesSearch.addEventListener("input", renderSales);
$("#catalogSearch").addEventListener("input", renderCatalog);
$("#catalogCategory").addEventListener("change", renderCatalog);
refs.saleProductSelect.addEventListener("change", () => { refs.saleUnitPrice.dataset.changed = ""; updateSalePrice(); });
refs.saleUnitPrice.addEventListener("input", () => { refs.saleUnitPrice.dataset.changed = "1"; updateSalePrice(); });
refs.saleForm.elements.quantity.addEventListener("input", updateSalePrice);
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
[refs.productDialog, refs.saleDialog, refs.interestDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
refs.inventoryRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const product = products.find((entry) => entry.id === button.dataset.id);
  if (button.dataset.action === "edit") openProductDialog(product);
  if (button.dataset.action === "sell") openSaleDialog(button.dataset.id);
});
refs.catalog.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="request"]');
  if (button) openInterestDialog(button.dataset.id);
});
$("#adminInterestRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-interest-status]");
  if (!button) return;
  try {
    await updateDoc(doc(db, "interests", button.dataset.id), { status: button.dataset.interestStatus, reviewedAt: Date.now() });
    await loadCloudData(); render(); showToast(`Request ${button.dataset.interestStatus}.`);
  } catch (error) { showToast(authErrorMessage(error), true); }
});
$("#teamRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-promote-admin]");
  if (!button) return;
  const profile = profiles.find((entry) => entry.id === button.dataset.promoteAdmin);
  if (!profile || profile.isAdmin) return;
  try {
    await setDoc(doc(db, "adminUsers", profile.id), { role: "admin", addedAt: Date.now(), addedBy: currentUser.uid });
    await loadCloudData();
    render();
    showToast(`${profile.email || "Account"} now has admin access.`);
  } catch (error) { showToast(authErrorMessage(error), true); }
});
refs.productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(refs.productForm);
  const product = { id: form.get("id") || "", name: String(form.get("name")).trim(), sku: String(form.get("sku")).trim(), category: form.get("category"), stock: Number(form.get("stock")), cost: Number(form.get("cost")), price: Number(form.get("price")), minStock: Number(form.get("minStock")) };
  try {
    await saveProduct(product); await loadCloudData(); render(); refs.productDialog.close();
    showToast(product.id ? "Part details updated." : "Part added to catalog.");
  } catch (error) { showToast(authErrorMessage(error), true); }
});
$("#deleteProductButton").addEventListener("click", async () => {
  const id = refs.productForm.elements.id.value;
  if (!id || !window.confirm("Remove this part from the catalog? Sales history will be kept.")) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "products", id));
    batch.delete(doc(db, "productCosts", id));
    await batch.commit();
    await loadCloudData(); render(); refs.productDialog.close(); showToast("Part removed.");
  }
  catch (error) { showToast(authErrorMessage(error), true); }
});
refs.saleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await recordSale(refs.saleProductSelect.value, Number(refs.saleForm.elements.quantity.value), Number(refs.saleUnitPrice.value));
    await loadCloudData(); render(); refs.saleDialog.close(); showToast("Sale saved and stock updated.");
  } catch (error) { showToast(authErrorMessage(error), true); }
});
refs.interestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(refs.interestForm);
  try {
    await sendInterest(form.get("productId"), Number(form.get("quantity")), String(form.get("message")).trim());
    await loadCloudData(); render(); refs.interestDialog.close(); showToast("Interest request sent to the shop.");
  } catch (error) { showToast(authErrorMessage(error), true); }
});
$("#customerAuthTab").addEventListener("click", () => selectAuthRole("customer"));
$("#adminAuthTab").addEventListener("click", () => selectAuthRole("admin"));
$("#authModeButton").addEventListener("click", () => {
  creatingAccount = !creatingAccount;
  const accountType = selectedAuthRole === "admin" ? "admin" : "customer";
  $("#authHeading").textContent = creatingAccount ? `Create your ${accountType} account` : selectedAuthRole === "admin" ? "Administrator sign in" : "Welcome back";
  $(".login-intro").textContent = creatingAccount && selectedAuthRole === "admin"
    ? "Register the account you will use to sign in. Admin access is activated by the first-time setup or an existing admin."
    : creatingAccount ? "Create an account to browse parts and contact the shop."
      : selectedAuthRole === "admin" ? "Sign in with an account that has administrator access."
        : "Sign in to browse parts or create a customer account.";
  $("#authSubmit").textContent = creatingAccount ? "Create account" : "Sign in";
  $("#googleSignIn").lastChild.textContent = creatingAccount ? "Create account with Google" : "Continue with Google";
  $("#authModeButton").textContent = creatingAccount ? "Already have this account? Sign in" : selectedAuthRole === "admin" ? "Create an admin account" : "New here? Create a customer account";
  $("#authError").textContent = "";
});
$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    if (creatingAccount) {
      pendingAdminRegistration = selectedAuthRole === "admin";
      await createUserWithEmailAndPassword(auth, form.get("email"), form.get("password"));
    }
    else await signInWithEmailAndPassword(auth, form.get("email"), form.get("password"));
  } catch (error) {
    pendingAdminRegistration = false;
    $("#authError").textContent = authErrorMessage(error);
  }
});
$("#googleSignIn").addEventListener("click", async () => {
  pendingAdminRegistration = creatingAccount && selectedAuthRole === "admin";
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (error) { pendingAdminRegistration = false; $("#authError").textContent = authErrorMessage(error); }
});
$("#accountButton").addEventListener("click", () => signOut(auth));
$("#notificationButton").addEventListener("click", () => setView(currentRole === "admin" ? "interestsView" : "customerRequestsView"));

$("#todayLabel").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
$("#greetingDate").textContent = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();

if (useFirebase) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) {
      currentRole = "";
      refs.appShell.hidden = true;
      refs.landingPage.hidden = false;
      $("#authSubmit").disabled = false;
      $("#googleSignIn").disabled = false;
      return;
    }
    refs.landingPage.hidden = false;
    refs.appShell.hidden = true;
    $("#authSubmit").disabled = true;
    $("#googleSignIn").disabled = true;
    $("#authError").textContent = "Checking your account access...";
    $("#storageLabel").textContent = "Checking account access";
    try {
      await syncUserProfile(user);
      const adminRecord = await getDoc(doc(db, "adminUsers", user.uid));
      const actualRole = adminRecord.exists() ? "admin" : "customer";
      if (selectedAuthRole === "admin" && actualRole !== "admin") {
        const sameAccount = user.email ? `Sign in afterward with ${user.email}.` : "Sign in afterward with the same Google account.";
        $("#authError").textContent = pendingAdminRegistration
          ? `Admin account created, but access is pending. For the first admin, create adminUsers/${user.uid} in Firestore. UID: ${user.uid}. ${sameAccount}`
          : `This account has no admin role. Ask an existing admin to add UID ${user.uid} in Team access. ${sameAccount}`;
        pendingAdminRegistration = false;
        await signOut(auth);
        return;
      }
      currentRole = actualRole;
      await loadCloudData();
      setRoleNavigation();
      render();
      refs.landingPage.hidden = true;
      refs.appShell.hidden = false;
    } catch (error) {
      refs.landingPage.hidden = false;
      refs.appShell.hidden = true;
      $("#authError").textContent = `Could not verify or load this account: ${authErrorMessage(error)}. Check the deployed Firestore rules and adminUsers record.`;
      await signOut(auth);
    }
  });
} else {
  products = sampleProducts.map((product) => ({ ...product }));
  sales = []; interests = []; currentRole = "admin"; currentUser = { email: "Demo workspace", uid: "demo" };
  refs.landingPage.hidden = true; refs.appShell.hidden = false;
  $("#storageLabel").textContent = "Local demo data";
  $("#accountLabel").textContent = "Demo mode";
  $("#userLabel").textContent = "Local browser only";
  setRoleNavigation(); render();
}
