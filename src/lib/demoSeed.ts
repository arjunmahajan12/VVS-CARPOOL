// Static seed data for the in-memory demo backend (v8). Pure data — the demo
// engine (demo.ts) turns it into users / children / carpools and then SIMULATES
// a few completed trips through the real stop state machine so Replay, stats
// and the admin analytics have realistic data on first open.
//
// Coordinates are real Vasant Kunj / Mahipalpur / Rangpuri positions around
// Vasant Valley School (28.533246, 77.144098).
import type { DriverDoc, Vehicle } from "./types";

export const SCHOOL = { name: "Vasant Valley School, Vasant Kunj", lat: 28.533246002067454, lng: 77.14409813768475 };

export interface SeedChild { name: string; class_level: number; gender: string; allergies?: string; emergency_name?: string; emergency_phone?: string; }
export interface SeedFamily {
  id: string; name: string; email: string; phone: string;
  colony: string; pincode: string; address: string;
  dLat: number; dLng: number;                 // offset from the school (degrees)
  existing_carpool: boolean; can_drive: boolean;
  status: "approved" | "pending";
  kids: SeedChild[];
}

// Demo families. Distances from the school are realistic for the colony named.
export const FAMILIES: SeedFamily[] = [
  { id: "asha", name: "Asha Mehta", email: "asha@demo.in", phone: "+91 98111 11111",
    colony: "Vasant Kunj B-6", pincode: "110070", address: "B-6/142, Vasant Kunj",
    dLat: 0.012, dLng: 0.010, existing_carpool: false, can_drive: true, status: "approved",
    kids: [{ name: "Riya Mehta", class_level: 6, gender: "female", allergies: "Peanut allergy — carries an EpiPen", emergency_name: "Asha Mehta", emergency_phone: "+91 98111 11111" }] },
  { id: "vikram", name: "Vikram Sharma", email: "vikram@demo.in", phone: "+91 98222 22222",
    colony: "Vasant Kunj C-9", pincode: "110070", address: "C-9/88, Vasant Kunj",
    dLat: 0.018, dLng: -0.006, existing_carpool: true, can_drive: true, status: "approved",
    kids: [{ name: "Aarav Sharma", class_level: 6, gender: "male" }, { name: "Diya Sharma", class_level: 3, gender: "female" }] },
  { id: "neha", name: "Neha Gupta", email: "neha@demo.in", phone: "+91 98333 33333",
    colony: "Vasant Kunj A-1", pincode: "110070", address: "A-1/23, Vasant Kunj",
    dLat: -0.009, dLng: 0.014, existing_carpool: false, can_drive: true, status: "approved",
    kids: [{ name: "Kabir Gupta", class_level: 7, gender: "male" }] },
  { id: "rahul", name: "Rahul Verma", email: "rahul@demo.in", phone: "+91 98444 44444",
    colony: "Rangpuri", pincode: "110037", address: "H-31, Rangpuri",
    dLat: 0.028, dLng: 0.020, existing_carpool: true, can_drive: true, status: "approved",
    kids: [{ name: "Sara Verma", class_level: 5, gender: "female" }] },
  { id: "priya", name: "Priya Nair", email: "priya@demo.in", phone: "+91 98555 55555",
    colony: "Mahipalpur", pincode: "110037", address: "K-9, Mahipalpur Extension",
    dLat: -0.020, dLng: 0.030, existing_carpool: false, can_drive: false, status: "approved",
    kids: [{ name: "Ishaan Nair", class_level: 6, gender: "male" }] },
  { id: "sunita", name: "Sunita Rao", email: "sunita@demo.in", phone: "+91 98666 66666",
    colony: "Vasant Kunj D-2", pincode: "110070", address: "D-2/1019, Vasant Kunj",
    dLat: 0.006, dLng: -0.013, existing_carpool: false, can_drive: true, status: "approved",
    kids: [{ name: "Myra Rao", class_level: 4, gender: "female" }] },
  { id: "rohan", name: "Rohan Kapoor", email: "rohan@demo.in", phone: "+91 98777 77777",
    colony: "Vasant Kunj E-3", pincode: "110070", address: "E-3/301, Vasant Kunj",
    dLat: 0.004, dLng: 0.008, existing_carpool: false, can_drive: true, status: "pending",
    kids: [{ name: "Anaya Kapoor", class_level: 5, gender: "female" }] },
];

export interface SeedAddon {
  id: string; owner: string; name: string; email: string; relation: string; phone?: string;
  vehicle?: Vehicle; documents?: DriverDoc[]; driver_status?: "verified" | "incomplete";
}
export const ADDONS: SeedAddon[] = [
  { id: "driver1", owner: "asha", name: "Ramesh Kumar", email: "driver@demo.in", relation: "driver", phone: "+91 98700 12345",
    vehicle: { make_model: "Maruti Ertiga", color: "Silver", plate: "DL 3C AB 1234", seats: 6 },
    documents: [
      { id: "d1", type: "licence", number: "DL-0420110149646", expiry: "2029-06-30", status: "verified" },
      { id: "d2", type: "insurance", number: "INS-88213947", expiry: "2027-03-15", status: "verified" },
      { id: "d3", type: "puc", number: "PUC-5521", expiry: "2026-12-01", status: "verified" },
    ], driver_status: "verified" },
  { id: "dadi1", owner: "asha", name: "Dadi", email: "dadi@demo.in", relation: "grandparent" },
  { id: "driver2", owner: "vikram", name: "Suresh Yadav", email: "suresh@demo.in", relation: "driver", phone: "+91 98220 55667",
    vehicle: { make_model: "Toyota Innova", color: "White", plate: "DL 8C XY 7788", seats: 7 },
    documents: [
      { id: "e1", type: "licence", number: "DL-0520120033112", expiry: "2028-01-20", status: "verified" },
      { id: "e2", type: "insurance", number: "INS-66120033", expiry: "2027-08-10", status: "verified" },
    ], driver_status: "verified" },
];

export const ADMIN = { id: "admin", name: "VVS School Admin", email: "admin@vasantvalley.demo" };

export const CARPOOL = {
  id: "cp1", name: "Vasant Kunj B-Block Morning", creator_id: "asha", seats: 4,
  driver_name: "Ramesh Kumar", driver_phone: "+91 98700 12345", driver_vehicle: "DL 3C AB 1234",
  members: [
    { parent_id: "asha", role: "creator" as const, status: "joined" as const },
    { parent_id: "neha", role: "member" as const, status: "joined" as const },
    { parent_id: "sunita", role: "member" as const, status: "invited" as const },
  ],
};

export const TNC_V1 = "By using Vasant Valley Carpool you agree to share your approximate home location with matched, school-verified families to arrange carpools, keep contact details accurate, and use the platform safely and respectfully.";

export const SEED_CHAT = [
  { sender: "asha", body: "Ramesh will drive tomorrow — leaving B-6 at 7:20 sharp.", minutesAgo: 60 * 20 },
  { sender: "neha", body: "Perfect, Kabir will be at the gate. Thank you!", minutesAgo: 60 * 19 },
];

// ---- simulation script for the seeded history -----------------------------
// Each completed trip is DRIVEN through the real state machine (postLocation)
// with the demo clock overridden, so stops/pings/events/stats are genuine.
export interface SeedTrip {
  daysAgo: number; startIst: string;           // "HH:MM" IST
  direction: "to_school" | "from_school";
  driver: string;                              // driver user id
  speedKmh: number;                            // cruising speed between stops
  stopDwellS: number;                          // how long the car really sits at each stop
  skipStopFor?: string;                        // child NAME whose home is driven past (missed pickup)
}
export const SEED_TRIPS: SeedTrip[] = [
  { daysAgo: 4, startIst: "07:24", direction: "to_school", driver: "driver1", speedKmh: 26, stopDwellS: 35, skipStopFor: "Kabir Gupta" },
  { daysAgo: 4, startIst: "14:12", direction: "from_school", driver: "driver1", speedKmh: 24, stopDwellS: 40 },
  { daysAgo: 3, startIst: "07:19", direction: "to_school", driver: "driver1", speedKmh: 28, stopDwellS: 30 },
  { daysAgo: 3, startIst: "14:15", direction: "from_school", driver: "asha", speedKmh: 22, stopDwellS: 45 },
  { daysAgo: 2, startIst: "07:36", direction: "to_school", driver: "driver1", speedKmh: 21, stopDwellS: 50 },
  { daysAgo: 2, startIst: "14:11", direction: "from_school", driver: "driver1", speedKmh: 25, stopDwellS: 35 },
  { daysAgo: 1, startIst: "07:21", direction: "to_school", driver: "driver1", speedKmh: 27, stopDwellS: 30 },
  { daysAgo: 1, startIst: "14:14", direction: "from_school", driver: "driver1", speedKmh: 23, stopDwellS: 40 },
];
