/* =====================================================
   CENTRAL CONFIGURATION — edit this file only.
   Leave a value as "" until the client confirms it.
   ===================================================== */
window.SITE = {
  name: "Nidhi Capital",    // Official company name
  phone: "",                // Digits with country code for tel: links, e.g. "91XXXXXXXXXX"
  phoneDisplay: "",         // How the number is shown, e.g. "+91 XXXXX XXXXX"
  email: "",                // Business email
  whatsapp: "918893895214", // Digits only with country code (+91 88938 95214)
  address: "",              // Office address
  hours: "",                // e.g. "Mon–Sat, 10:00 AM – 7:00 PM"
  registration: "",         // Registration / licence details (leave empty unless this company has its own)
  grievanceOfficer: "",     // Grievance Redressal officer name
  grievanceContact: "",     // Grievance officer email / phone
  registration_note: "",         // Registration / licence details (only if verified)
  description: "Asaan Loan, Nidhi ka Vachan.", // Company description / tagline
  mapEmbedUrl: "",          // Google Maps "Embed a map" src URL
  waMessage: "Hello, I would like to know more about your loan services. Please share the available options and eligibility requirements.",
  emiRate: 6,               // indicative EMI rate (% per year) used in the registration EMI calculator
  amountMin: 10000, amountMax: 100000000,

  /* Loan categories — edit, add or remove. Shown on Home, Services, forms. */
  services: [
    {id:"personal", group:"personal", name:"Personal Loans", icon:"user", secured:"Usually unsecured",
     desc:"Flexible funding for planned or unplanned personal expenses.",
     uses:["Medical expenses","Weddings and events","Travel","Home renovation"],
     elig:"Usually salaried or self-employed adults with a regular income and an acceptable credit history.",
     docs:["Identity and address proof","Recent income proof or bank statements","Passport-size photographs"]},
    {id:"business", group:"business", name:"Business Loans", icon:"briefcase", secured:"Secured or unsecured",
     desc:"Working capital and growth funding for shops, firms and companies.",
     uses:["Working capital","Equipment purchase","Inventory","Expansion"],
     elig:"Usually businesses with a minimum operating history and verifiable turnover.",
     docs:["KYC of owners or directors","Business registration proof","Bank statements","GST or income tax returns"]},
    {id:"home", group:"property", name:"Home Loans", icon:"home", secured:"Secured by the property",
     desc:"Finance to buy, build or extend a residential property.",
     uses:["Buying a home","Construction","Extension or renovation","Plot purchase"],
     elig:"Usually adults with a stable income, a clear property title and an acceptable credit history.",
     docs:["Identity and address proof","Income proof","Property documents","Bank statements"]},
    {id:"lap", group:"property", name:"Loan Against Property", icon:"building", secured:"Secured by the property",
     desc:"Funding by keeping an owned residential or commercial property as security.",
     uses:["Business needs","Education costs","Debt consolidation","Large expenses"],
     elig:"Usually owners of a property with clear title and a repayment source.",
     docs:["KYC documents","Property title papers","Income proof","Bank statements"]},
    {id:"vehicle", group:"vehicle", name:"Vehicle Loans", icon:"car", secured:"Secured by the vehicle",
     desc:"Finance for new or used two-wheelers, cars and commercial vehicles.",
     uses:["New vehicle","Used vehicle","Commercial vehicle"],
     elig:"Usually adults with a regular income; the vehicle is held as security.",
     docs:["Identity and address proof","Income proof","Vehicle quotation or invoice","Bank statements"]},
    {id:"education", group:"education", name:"Education Loans", icon:"cap", secured:"Varies by lender",
     desc:"Funding for tuition and related costs in India or abroad.",
     uses:["Tuition fees","Hostel and living costs","Books and equipment","Study abroad"],
     elig:"Usually students with an admission offer and a co-applicant such as a parent.",
     docs:["Admission letter","Fee structure","Student and co-applicant KYC","Co-applicant income proof"]}
  ],
  groups:{all:"All loans",personal:"Personal",business:"Business",property:"Home and property",vehicle:"Vehicle",education:"Education"}
};
