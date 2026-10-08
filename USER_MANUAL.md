# Sabesh Capital — User Manual & Operations Guide

This manual explains every part of the Sabesh system for the **owner/admin** (computer or phone) and for **field agents** (phone). It covers the cash-loan system, the Chit Fund (Ticket) portal and the Pawn portal.

The organisation name shown in the app (header, printed documents, SMS and WhatsApp messages) comes from **Settings → Organization**. Change it there, not in the code.

---

## Contents
1. [Getting started](#1-getting-started)
2. [Finding your way around](#2-finding-your-way-around)
3. [How loans and interest work](#3-how-loans-and-interest-work)
4. [Admin guide — Finance portal](#4-admin-guide--finance-portal)
5. [Agent guide](#5-agent-guide)
6. [Chit Fund (Ticket) portal](#6-chit-fund-ticket-portal)
7. [Pawn portal](#7-pawn-portal)
8. [What the system does by itself](#8-what-the-system-does-by-itself)
9. [Rules, safety and troubleshooting](#9-rules-safety-and-troubleshooting)

---

## 1. Getting started

### Who uses the system
| Person | Logs in? | What they can do |
| :--- | :--- | :--- |
| **Admin** (owner) | Yes | Everything: loans, users, cash, reports, chit funds, pawn (if switched on). |
| **Agent** (field staff) | Yes | Collect payments on their own route, submit new loan applications for approval, hand cash over to the office. |
| **Borrower / customer** | No | Does not use the app. They receive SMS messages and may fill in the public application form. |

### Logging in
1. Open the website and enter your **phone number** and **password**.
2. Tap **Login**.
3. Too many attempts from the same network (10 within 15 minutes) pauses logging in for 15 minutes.

**Forgot your password?** Tap **Forgot password?** on the login screen. A 6-digit code is sent by SMS (valid 10 minutes). Enter it and choose a new password. This only works if SMS is set up (see section 8). If it isn't, ask an admin to set a new password for you (section 4.1).

**First login with a temporary password:** if an admin set your password, you are asked to choose your own straight away.

### Choosing a portal
After login you may see a screen with up to three cards:
- **Finance Portal** — loans, collections, cash, reports.
- **Ticket Portal** — Chit Fund ledger.
- **Pawn Portal** — vehicle and gold jewellery pawn loans (admins with Pawn access only).

If you only have access to one portal you go straight in. Use **Switch Portal** (top bar) to move between portals.

### Using it on a phone
The app works in the phone browser and can be installed to the home screen ("Add to Home Screen"). On a phone the top menu becomes a **bottom bar**.

---

## 2. Finding your way around

### Admin — computer
Top bar: **Home · Give Loan · Applications · Record Payment · Check Loans · Agent Route · More · Switch Portal**.

**More** opens a menu:
- *Daily work:* Borrower Applications, Agent Route Progress, Next Day Tasklist
- *Money:* Users & Cash, Interest Accrual Center, Payment History
- *Records:* Audit Log, SMS Log

### Admin — phone
Bottom bar: **Home · Loans · Give Loan · Record · More**. A red number on **Loans** shows overdue accounts; a number on **More** shows pending applications. **More** opens the same grouped menu as above.

### Agent — phone
Bottom bar: **Route · Give Loan · Remit · Applications · More**.
- **Route** — today's collection sheet (your main screen).
- **Remit** — hand cash over to the office.
- **More** — Next Day Tasklist and Collection History.

Agents on a computer see the same items in the top bar (Route Sheet, Single Payment, Next Day Tasklist, Collection History, Remit Cash).

### Phone numbers are tap-to-call
Wherever a member's or customer's phone number appears in the app, tapping it dials that number on a phone. The green button beside it opens WhatsApp.

---

## 3. How loans and interest work

### The loan types
When giving a loan you choose how interest builds up (**Daily, Weekly or Monthly**) and the **loan term**.

| Type | How it works |
| :--- | :--- |
| **Open-ended** (Daily, Weekly or Monthly) | Interest keeps building each period until the principal is fully repaid. The customer pays **interest** and/or **principal** whenever they can. |
| **Fixed term** (Weekly or Monthly) | Same as above, but with an end date based on the duration you enter. |
| **Daily Fixed Term ("daily installment")** | One fixed amount (principal + interest together) is collected **every day** for the whole term. |

### The interest rate is always a monthly rate
- **Monthly** loan: interest per month = principal × rate ÷ 100.
- **Weekly** loan: monthly interest ÷ 4, added every 7 days.
- **Daily** loan: monthly interest ÷ 30, added every day.

*Example (weekly):* LKR 100,000 at 4% → LKR 4,000 a month → **LKR 1,000 interest each week**.
*Example (daily, open-ended):* LKR 40,000 at 3% → LKR 1,200 a month → **LKR 40 interest each day**.

### Daily Fixed Term
The duration must be a **multiple of 31 days** (31 = 1 month, 62 = 2 months, 93 = 3 months…). One extra collection day per month is collected.
- Total interest = principal × rate ÷ 100 × number of months.
- Daily installment = (principal + total interest) ÷ (duration − number of months).
- Collection starts on the day the loan is given.

*Example:* LKR 30,000 at 10% for 31 days → interest LKR 3,000 → daily installment **LKR 1,100.00**, collected 31 times → customer repays **LKR 34,100.00** in total.

### Paying interest and principal
- **Interest payment** — reduces the interest owed. Principal stays the same.
- **Principal payment** — reduces the money borrowed. When principal reaches zero the loan is **Fully Paid**.
- If you enter **more than is owed**, the system records only what is owed and tells you the **change to return** to the customer.
- A daily-installment payment is split automatically between principal and interest in a fixed ratio.

### Loan statuses
| Status | Meaning |
| :--- | :--- |
| **Pending approval** | An agent submitted it; no cash has moved. |
| **Active** | Disbursed and collecting. |
| **Fully paid** | Closed. |
| **Defaulted** | Locked — agents cannot collect until an admin reinstates it. |
| **Rejected** | Admin declined an agent's application. |
| **Written off** | Closed as bad debt. |

### Where the money is recorded
Every money movement is recorded twice (double-entry ledger) so the books always balance: giving a loan, interest building up, penalties, payments, agent cash handovers and write-offs. The pawn portal has its own separate ledger (section 7).

---

## 4. Admin guide — Finance portal

### 4.1 Users & staff (More → Users & Cash → User Management)

**Add a user**
1. Open **Users & Cash**, then **User Management**, then **Add New User**.
2. Enter name, **mobile number** (this is the login), role (Admin or Agent) and a starting password.
3. Tick the portals they may use: **Finance**, **Ticket**, and (admins only) **Pawn**.
4. Tap **Create User**.

**Edit a user** — tap **Edit Details** to change name, phone, email, role and portal access.

**Set a new password** — in the same Edit window open **Set a new password**:
1. Type the new password twice (6+ characters).
2. Type **your own password** to confirm.
3. Leave *"Make them choose their own password at next login"* ticked (recommended), then tap **Set Password**.

Use this when the SMS reset code can't reach the person. Tell them the new password in person. The change is recorded in the Audit Log (the password itself is never stored there). You can also set your own password this way.

**Send Reset Code** — sends an SMS code so the person sets their own password from the login screen. Needs SMS to be working.

**Change your own password** — **Settings → Security & Password** (needs your current password).

**Deactivate / Activate** — stops or restores a person's login without deleting anything.

**Delete a user** — asks for your password and is refused if the person has loans, payments or cash handovers on record (deactivate them instead).

### 4.2 Giving a loan (Give Loan)
The form has steps; the first is the only essential one.

1. **KYC Profile** — borrower name, mobile number and NIC are required. Address, email, date of birth, NIC photos and photo proof are optional. Tap **Fast Terms (Skip Step 2)** to jump straight to the loan terms, or **Continue to Step 2**.
2. **Financial Profile** — optional: purpose of the loan, monthly income, spouse details.
3. **Loan Terms** — principal amount, interest rate (% per month), **Accrual Frequency** (Daily/Weekly/Monthly), **Issued Date** (can be set to a past date to enter an old loan; not in the future), **Loan Term** (Open-ended or Fixed term with a duration) and **Assign Collection Agent**.
4. Optionally tick **Include guarantor** to add guarantor details (step 4). A guarantor can back at most 3 active/pending loans.
5. Tap **Disburse Cash Loan**. The customer gets an SMS and the loan appears in Check Loans.

If a field is wrong, a red message appears under it and the screen scrolls to it.

### 4.3 Approving loans submitted by agents
Agent-submitted loans wait as **Pending approval** (shown on the Home screen and in Check Loans). Open one with **Review →** and **Approve** (cash is considered disbursed and interest starts from approval) or **Reject** with a reason. The agent is notified by SMS.

### 4.4 Applications from customers (Applications)
Customers (or a family member) can fill in the public application form in **English or Tamil**.
- On the Applications screen tap **Copy Link** or **Share via WhatsApp** and send it to the customer.
- Submissions appear under **Pending**. Review one, then **Create Loan from This** (opens Give Loan pre-filled) or **Dismiss** it.
- Filters: Pending, Converted, Dismissed, All.

### 4.5 Finding and managing loans (Check Loans)
- Search by name, phone, NIC or reference. Filter by status, agent, collection type and period. **Needs Follow-up** shows active loans that haven't paid for a long time.
- **Export CSV** downloads the list.
- **Update Interest Now** adds any interest that has fallen due (this also happens automatically every morning).
- Tap a loan (**View →**) to open its file.

**Inside a loan file**
- **Passbook & Payments** — the activity log, the **Record a Payment** box, and the list of payments received (with WhatsApp and Print for each receipt). For daily installments you will see *"Day X of 31"* progress.
- **Borrower Profile** and **Guarantor Info** (add, edit or remove a guarantor).
- **Manage Loan** (admin only):
  - **Edit Terms** — change the interest rate (future periods only) or reassign the agent.
  - **Extend Loan Term** — gives a struggling borrower more time; the payment amount stays the same.
  - **Apply Late Fee / Penalty** — adds an amount to the interest owed (the borrower is told by SMS).
  - **Mark Defaulted** — locks the loan so agents cannot collect; **Reinstate** unlocks it.
  - **Write Off as Bad Debt** — permanently closes it and records the loss.
  - **Delete Loan** — permanent; needs a reason and your password, and is refused if the loan has payments.
- **View Agreement / Download PDF** — the printable loan agreement.

### 4.6 Recording payments (Record Payment)
A collection sheet listing everyone due today, in tabs **Daily · Weekly · Monthly**, with a collection-date picker and an agent filter.
- **Full Due** — tick it to collect the whole amount due, or tick **Partial** and type the amount.
- Tap **Save** on a row, or **Save All Entered** to save everyone you've filled in.
- A person you've already collected from moves under **Done Today**.
- **Call** next to a name rings that borrower.

You can also record a single payment inside a loan file.

### 4.7 Agent cash (Users & Cash)
- **Agent Cash-in-Hand Reconciliation** shows, per agent: collected, remitted, and cash in hand.
- **Cash Handovers** lists the agents' handover requests. **Verify** accepts the cash (the agent's cash in hand goes down); **Reject** declines it. **Export CSV** is available.
- **Ledger Report** shows the company accounts and whether the books balance.

### 4.8 Reports and records (More menu)
- **Next Day Tasklist** — what is due tomorrow, split into Daily, Weekly and Monthly, with a quick link to record the payment.
- **Agent Route Progress** — what each agent has collected today.
- **Interest Accrual Center** — interest earned by frequency and recent accrual logs.
- **Payment History** — every payment, searchable by name/phone/NIC/code, with date, method and type filters and **Export CSV**.
- **Audit Log** — who did what and when; filter by action type and date.
- **SMS Log** — every message the system tried to send and whether it was **Sent**, **Failed** or **Mocked** (not actually sent because SMS isn't set up).

### 4.9 Settings
- **Settings → Organization** — organisation name and logo.
- **Users & Cash → Reminder Settings & Alerts** — how many days **before the due date** the payment reminder SMS is sent.
- **Settings → Edit Profile / Security & Password** — your own details and password.

---

## 5. Agent guide

### 5.1 A normal day
**Morning** — open **Route**. You see the customers due today. Use **More → Next Day Tasklist** the evening before to plan the round.

**At each visit**
1. Find the customer on the **Route sheet**.
2. Tick **Full Due**, or **Partial** and enter the amount.
3. Tap **Save**. The customer moves to **Done Today**.
4. Tap the phone number to call a customer who isn't home.

**End of day** — open **Remit**, enter the cash you are handing over, add notes and submit. The office **Verifies** it; until then it stays pending.

### 5.2 Route sheet vs Single payment
At the top of the Route screen there are two tabs:
- **Route sheet** — the fast list for today's round (default).
- **Single payment** — pick one customer from a searchable list, choose **Pay Interest** or **Pay Principal**, and enter the amount.

### 5.3 Giving a loan as an agent
Use **Give Loan**. The loan is **submitted for approval** — no cash moves until an admin approves it. You are notified by SMS when it is approved or rejected. You can only submit loans collected by yourself.

### 5.4 Applications
**Applications** lists customer-submitted forms so you can turn them into a loan application.

### 5.5 When a customer does not pay
- Simply don't save a payment for that customer.
- A daily-installment loan that falls **3 or more days behind** sends an SMS to the customer, to you and to the admin, and repeats daily until it is paid.
- Call the customer from the tap-to-call number and tell the admin if the problem continues.

### 5.6 Mistakes and no internet
- A wrong payment cannot be edited by an agent — tell the admin.
- If there is **no internet**, a payment is **saved on your phone** and shown as **"N pending sync"** at the top. It sends automatically when you are back online; tap the badge to retry now. Do not enter the same payment twice.

### 5.7 Do and don't
- **Do** save each payment straight after collecting it.
- **Do** remit your cash daily.
- **Don't** share your password. **Don't** collect on a loan marked Defaulted — it is locked.

---

## 6. Chit Fund (Ticket) portal

A chit group has a fixed number of members and runs one round per member. Each round, members bid (a discount); the winner receives the total less the bid, and everyone pays a share plus the host fee.

### 6.1 Create a group
**Create New Group** → name, total value, member count, start date, host fee (a **percentage** of each member's share or a **fixed amount**), and optionally a **starting round** if the group already ran some rounds on paper.

### 6.2 Members
Open a group → **Member Roster**.
- **Add** one at a time or paste a list (*Name, Phone*) in **bulk**.
- Tap a phone number to **call**; the green button opens WhatsApp.
- **Edit** (pencil) changes a name or phone.
- **Remove** (bin) deletes a member. It is **refused** if the member has already won a round (change that round's winner first) or has payments marked paid (un-tick them first).

### 6.3 Running a round
**Round Auction & Notice** → enter the **bid amount**, the **winner** (optional now, can be set later), the auction date and the next round date, then run it. The system calculates:
- Winner payout = total value − bid.
- Each member's share = payout ÷ members, plus the host fee.

A shareable notice is generated for WhatsApp.

### 6.4 Payments tracker
**Payments Tracker** lists each member's payment for a chosen round. Tick **paid** when received. For unpaid members, a **WhatsApp reminder** is prepared (headed with your organisation's name); tap the phone number to call.

### 6.5 Past rounds
**Past Auctions History** shows every round. Admins can:
- **Edit** a round — change the winner or the date. The money amounts of that round do not change.
- **Undo** the **latest** round — removes it so you can run it again with the right bid. Refused if any payment of that round is marked paid.

### 6.6 Edit a group
Use the **pencil** on the group card, or **Edit Group** inside a group, to change the name, total value, host fee, start date, next round date and member count.
- **Total value and host fee changes apply only to rounds not yet run.** Rounds already run keep their recorded amounts.
- Member count is also the number of rounds. It can go up (more rounds) or down, but not below the members on the roster or the rounds already run.
- **Delete Group** permanently removes the group and its entire history (you must type its name to confirm).

---

## 7. Pawn portal

For loans secured by a **vehicle** or **gold jewellery**. It has its own loans, payments, interest and ledger, separate from the cash loans. Only admins with **Pawn Portal Access** can use it (turn it on under Users & Cash → Edit Details).

### 7.1 Record a pawn loan
**New Pawn Loan** has three parts:
1. **Customer details** — name, father/husband name, NIC, mobile, occupation, monthly income, reference name and number, address.
2. **Pawned item** — choose **Vehicle** (make/model, registration number) or **Gold jewellery** (weight in grams, karat, serial/tag), a description, the **estimated value** (you type it), where it is stored, and up to 4 photos of the item and of documents.
3. **Loan terms** — loan amount, interest rate (% per month), how often interest is collected (monthly, weekly or daily), loan period in months, and an optional start date for entering an older paper ticket.

A preview shows the interest per period, the **due date**, and how much of the item's value you are lending (a warning appears if you lend more than it is worth). The customer gets an SMS and the loan gets a ticket number like **PWN-001**.

Interest works exactly like the cash loans (section 3) and is added by the same daily job. It stops building once the principal is fully repaid.

### 7.2 The list
Filters: **Active · Overdue · Ready to forfeit · Redeemed · Forfeited · All**, plus **All items / Vehicles / Gold** with counts, and a search box (name, NIC, phone, ticket number or item).

### 7.3 Working on a loan
Open a loan to see balances, the item and customer, payments and interest history.
- **Record a payment** — **Pay interest** or **Pay principal**. When both interest and principal reach zero the loan becomes **Redeemed**.
- **Return item to customer** — once redeemed, hand the item back and confirm.
- **Extend due date** — gives more months; interest keeps building.
- **Print ticket** — the pawn ticket in **English** or **தமிழ்**, ready to print and sign.

### 7.4 When the customer doesn't pay
- After the due date the loan shows **N days overdue**.
- The customer has a **30-day grace period** after the due date. SMS reminders go out on day 1, day 15 and day 30 overdue.
- After the grace period the loan shows **Ready to forfeit**. **Forfeit item** closes the loan: sale/auction proceeds pay the **interest first, then the principal**; any extra money is recorded as **owed back to the customer**, any shortfall is **written off**. You can forfeit early only by ticking a clear confirmation box.

---

## 8. What the system does by itself

| When | What happens |
| :--- | :--- |
| **Every morning (about 5:30 AM, Sri Lanka time)** | Interest that has fallen due on every active loan (cash and pawn) is added. If the job missed days, it catches up on all of them. |
| **Every morning (about 8:00 AM)** | Payment reminder SMS go to weekly/monthly borrowers a set number of days before the due date; pawn customers get due-date and overdue reminders; daily-installment loans **3+ days behind** alert the borrower, agent and admin. |
| **When a loan is given** | The borrower is told the amount and the collection amount. |
| **When a payment is recorded** | Weekly and monthly borrowers get a receipt; the admin gets an alert. Daily collections do **not** send an SMS each day. |
| **Penalty, default, reinstate, term extension** | The borrower is told by SMS. |
| **Agent submits a loan** | The admin is told; the agent is told when it is approved or rejected. |

**SMS needs setup.** SMS are sent through Text.lk. If its keys aren't configured for your organisation, messages are not actually sent — they appear in the **SMS Log** as **Mocked**. Check the SMS Log after setup to confirm messages show **Sent**.

---

## 9. Rules, safety and troubleshooting

1. **Don't double-submit.** If a page hangs after you save a loan or payment, don't tap again. Check Payment History or Check Loans first — duplicates are blocked, but check.
2. **An agent can't collect on a Defaulted loan.** An admin must **Reinstate** it first.
3. **Daily Fixed Term** durations must be 31, 62, 93… days.
4. **Signed out after typing a wrong password when deleting a user?** That is a known quirk — just log in again.
5. **A confirmation window stays on "Working…"?** Reload the page.
6. **Can't log in?** Check the phone number and password. After 10 attempts from the same network, logging in is paused for 15 minutes. An admin can set a new password for you.
7. **No Pawn Portal card?** Ask an admin to turn on **Pawn Portal Access** for your account, then log out and back in.
8. **Anything you did is recorded** in the Audit Log — including who changed a password, edited a chit group or forfeited a pawn loan.
9. **Keep backups.** Deleting loans, agents or groups cannot be undone.
