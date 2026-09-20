import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY

const ticket = "The app crashes whenever I tap the pay button. Not urgent, just letting you know.";

const res = await client.systemOne({
  state: { ticket },
  questions: {
    category: choice("What is the `ticket` primarily about?", {
      billing: "Charges, refunds, invoices, or payment issues",
      technical: "Bugs, errors, or product not working",
      other: "Anything else",
    }),
    churnRisk: noul("Is the customer in `ticket` threatening to leave or cancel?"),
    urgency: score("How urgent is the `ticket`?", [
      "Routine question, no time pressure",
      "Wants a fix soon but no explicit deadline or threat",
      "Demands immediate action, mentions deadlines, escalation, or cancelling",
    ]),
  },
});

console.log(JSON.stringify(res.answers, null, 2));
