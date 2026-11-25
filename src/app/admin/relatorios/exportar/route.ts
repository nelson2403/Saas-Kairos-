import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getMembership } from "@/lib/auth/dal";
import { parsePeriod } from "@/modules/finance/domain";
import { canSeeFinance } from "@/modules/finance/service";
import { REPORTS, buildReport, type ColumnType, type ReportKey } from "@/modules/reports/service";
import { todayBR } from "@/modules/sales/domain";

const FORMAT: Partial<Record<ColumnType, string>> = {
  money: '"R$" #,##0.00',
  qty: "#,##0.###",
  percent: '0.0"%"',
  date: "dd/mm/yyyy",
};

/** Exporta o relatório em .xlsx (mesmos dados da tela). Sem cache. */
export async function GET(request: Request) {
  const membership = await getMembership();
  if (!membership) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!canSeeFinance(membership.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const tipo = url.searchParams.get("tipo") ?? "";
  if (!(tipo in REPORTS)) return NextResponse.json({ error: "relatório inválido" }, { status: 400 });
  const key = tipo as ReportKey;
  const today = todayBR();
  const { from, to } = REPORTS[key].period ? parsePeriod(url.searchParams.get("de"), url.searchParams.get("ate"), today) : { from: today, to: today };
  const report = await buildReport(key, from, to);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Kairós";
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31));
  ws.addRow([report.title]).font = { bold: true, size: 14 };
  ws.addRow([report.subtitle]);
  ws.addRow([]);
  const header = ws.addRow(report.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE8E1" } };
  });

  const toCell = (value: string | number | null | undefined, type: ColumnType) => {
    if (value == null || value === "") return null;
    if (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00Z`);
    return value;
  };
  for (const row of report.rows) ws.addRow(report.columns.map((c) => toCell(row[c.key], c.type)));
  if (report.totals) {
    const totals = ws.addRow(report.columns.map((c) => toCell(report.totals![c.key], typeof report.totals![c.key] === "string" ? "text" : c.type)));
    totals.font = { bold: true };
  }
  if (report.note) {
    ws.addRow([]);
    ws.addRow([report.note]).font = { italic: true, color: { argb: "FF6B645C" } };
  }

  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (FORMAT[c.type]) col.numFmt = FORMAT[c.type]!;
    col.width = Math.min(48, Math.max(12, c.label.length + 4, ...report.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length + 2)));
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `kairos-${key}-${from}${REPORTS[key].period ? `_a_${to}` : ""}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
