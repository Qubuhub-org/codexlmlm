import OpenAI from "openai";

const client = new OpenAI();
const decision = await client.decisions.create({
  model: "gpt-6-luna",
  input: "Mochi is curled up in a sunny spot, purring softly and kneading a blanket. Her ears are relaxed and her eyes are half closed.",
  questions: [
    {
      type: "predicate",
      instructions: "Mochi the cat is relaxed and comfortable."
    }
  ]
});
console.log(decision.answers);
