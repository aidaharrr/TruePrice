import { Bot, Images, PackageSearch, type LucideIcon } from "lucide-react";

export type ScanStepId = "scrape" | "markup" | "analyze";

export type ScanStep = {
  id: ScanStepId;
  label: string;
  detail: string;
  icon: LucideIcon;
};

/** The real pipeline, in order: /api/scrape → /api/markup → /api/analyze. */
export const SCAN_STEPS: ScanStep[] = [
  {
    id: "scrape",
    label: "Reading the listing",
    detail: "Fetching the title, price and main photo from Amazon",
    icon: PackageSearch,
  },
  {
    id: "markup",
    label: "Factory price search",
    detail: "Reverse image search on AliExpress, Temu and Alibaba, then a title search if needed",
    icon: Images,
  },
  {
    id: "analyze",
    label: "AI photo & title check",
    detail: "Looking for AI-generated photos and keyword-stuffed titles",
    icon: Bot,
  },
];
