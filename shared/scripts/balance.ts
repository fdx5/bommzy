import { balanceReport, validateData, averageHp } from '../src/data/balance';

validateData();
console.log(`\n🎮 PASTEL BRAWL 밸런스 리포트 (평균 HP ${Math.round(averageHp())})\n`);
const rows = balanceReport();
console.table(rows);
let ok = true;
for (const r of rows) {
  if (r.ttk < 2.5 || r.ttk > 4.5) { ok = false; console.log(`⚠️  ${r.name}: TTK ${r.ttk}s (목표 2.5~4.5s)`); }
  if (r.attacksPerSuper < 4 || r.attacksPerSuper > 7) { ok = false; console.log(`⚠️  ${r.name}: 슈퍼 충전 ${r.attacksPerSuper}회 (목표 4~7회)`); }
}
console.log(ok ? '✅ 모든 기준 통과' : '❌ 기준 미달 항목 있음');
process.exit(ok ? 0 : 1);
