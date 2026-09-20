import type { Metadata } from "next";
import { MeetClient } from "./client";
import { decodeMeetParams, encodeMeetParams } from "@/lib/meet-url";
import { STATION_BY_ID } from "@/lib/stations";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const p = decodeMeetParams(await searchParams);
  const pick = p.pick ? STATION_BY_ID[p.pick] : null;
  const who = p.origins.map((o) => STATION_BY_ID[o.id]?.name).filter(Boolean);
  const title = pick ? `Meet at ${pick.name}` : "Where should we meet?";
  const description = pick && who.length ? `${who.join(", ")} → ${pick.name}${p.q ? ` · "${p.q}"` : ""}` : "Type what you fancy; Jev picks the station everyone can reach.";
  const image = `/meet/og${encodeMeetParams(p)}`;
  return {
    title,
    description,
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")),
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function MeetPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const initial = decodeMeetParams(sp);
  // The recording layout is known on the server, so the first paint is already dark (no light flash at the head of a take).
  return <MeetClient initial={initial} demo={sp.demo === "1"} />;
}
