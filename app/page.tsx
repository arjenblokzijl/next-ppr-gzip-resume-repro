import { cookies } from "next/headers";
import { Suspense } from "react";

// Reads request-time data, so it cannot be prerendered and "postpones" — this
// is the dynamic hole. The static markup around it forms the prerendered shell,
// making the route Partial Prerender (◐) with a postponed state.
async function DynamicPart() {
  const store = await cookies();
  return <p>dynamic: {store.get("demo")?.value ?? "none"}</p>;
}

export default function Page() {
  return (
    <main>
      <h1>static shell</h1>
      <Suspense fallback={<p>loading…</p>}>
        <DynamicPart />
      </Suspense>
    </main>
  );
}
