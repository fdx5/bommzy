type Dict = Record<string, string>;

const ko: Dict = {
  tapToStart: '화면을 터치해서 시작!', play: '대전 시작!', mode: '8인 개인전', characters: '캐릭터', records: '기록', settings: '설정',
  tutorial: '튜토리얼', select: '선택하기', selected: '선택됨', back: '뒤로', close: '닫기', hp: '체력', speed: '이동속도',
  weapon: '기본 무기', super: '슈퍼', gadget: '가젯', skins: '스킨', locked: '트로피 {n}개 필요', searching: '상대를 찾는 중…',
  fillingBots: '빈 자리는 봇이 채워요', cancel: '취소', alive: '생존', score: '점수', retired: '리타이어!', place: '{n}위',
  spectate: '관전하기', toLobby: '로비로', results: '결과 보기', again: '한 판 더!', victory: '최후의 1인!', top3: '대단해요!',
  defeatedBy: '{name}에게 당했어요', poisonBy: '독구름에 휩쓸렸어요', kills: '처치', damage: '데미지', assists: '어시스트',
  trophies: '트로피', newBest: '최고 기록 갱신!', levelUp: '레벨 업!', mvp: 'MVP', unlocked: '새 스킨 해금: {name}',
  quality: '그래픽 품질', auto: '자동', low: '낮음', medium: '보통', high: '높음', sfx: '효과음', music: '배경음악', vibration: '진동',
  leftHanded: '왼손잡이 모드', stickSize: '조이스틱 크기', stickOpacity: '조이스틱 투명도', aimSens: '조준 감도', uiScale: 'UI 크기',
  colorblind: '색약 모드', language: '언어', showStats: '성능 정보 표시', all: '전체', weekly: '주간', byChar: '캐릭터별', noRecords: '아직 기록이 없어요. 한 판 해볼까요?',
  pause: '일시정지', resume: '계속하기', quit: '나가기', rotate: '가로로 돌려주세요!', rotateSub: '더 넓은 화면에서 더 재미있어요',
  double: '더블 킬!', triple: '트리플 킬!', mega: '메가 킬!', bounty: '현상금 획득! +150', poison: '독구름이 몰려와요!', crownYou: '내가 왕관을 썼어요!',
  ev_flowers: '회복 꽃이 피어나요!', ev_supply: '보급 상자 투하!', ev_wind: '돌풍이 불어요! 탄이 휘어져요', ev_soon: '3초 후',
  superReady: '슈퍼 준비 완료!', hidden: '숨는 중', go: '시작!', nickname: '닉네임', level: 'Lv.', loading: '불러오는 중…',
  tut1: '조이스틱(WASD)으로 움직여 보세요', tut2: '공격 버튼(클릭)으로 허수아비를 맞춰요', tut3: '수풀 속에 숨어 보세요 — 적에게 안 보여요!',
  tut4: '슈퍼가 찼어요! 슈퍼로 바위를 부숴 보세요', tut5: '완벽해요! 이제 진짜 대전으로!', tutSkip: '건너뛰기', tutStart: '튜토리얼 해볼까요?',
  tutStartSub: '30초면 충분해요', yes: '좋아요', later: '나중에', wins: '승리', games: '판수', best: '최고 점수',
  controlsPc: 'WASD 이동 · 마우스 조준 · 클릭 공격 · E/우클릭 슈퍼 · Space 가젯 · T 이모트 · Tab 점수판',
  online: '온라인', myRecords: '내 기록', onlineAll: '🌐 전체', onlineWeekly: '🌐 주간', onlineChar: '🌐 {name}', lbOffline: '온라인 랭킹 서버에 연결할 수 없어요. 내 기록만 볼 수 있어요.', lbLoading: '랭킹 불러오는 중…', onlineRank: '🌐 온라인 {n}위', lbEmpty: '아직 등록된 기록이 없어요. 첫 1위를 차지해 보세요!',
  map: '맵', mapSelect: '맵 선택', randomMap: '랜덤 맵', randomMapDesc: '매 판 다른 맵에서!', tapToPick: '눌러서 선택',
  emote0: '😆', emote1: '😠', emote2: 'GG', emote3: '❤️', spectating: '관전 중: {name}', exitMatch: '정말 나갈까요? 이번 판은 패배로 기록돼요.',
};

const en: Dict = {
  tapToStart: 'Tap to start!', play: 'Battle!', mode: '8-player Showdown', characters: 'Brawlers', records: 'Records', settings: 'Settings',
  tutorial: 'Tutorial', select: 'Select', selected: 'Selected', back: 'Back', close: 'Close', hp: 'Health', speed: 'Speed',
  weapon: 'Attack', super: 'Super', gadget: 'Gadget', skins: 'Skins', locked: 'Needs {n} trophies', searching: 'Finding players…',
  fillingBots: 'Empty seats are filled with bots', cancel: 'Cancel', alive: 'Alive', score: 'Score', retired: 'Retired!', place: '#{n}',
  spectate: 'Spectate', toLobby: 'Lobby', results: 'Results', again: 'Play again!', victory: 'Last one standing!', top3: 'Great job!',
  defeatedBy: 'Defeated by {name}', poisonBy: 'Caught in the poison cloud', kills: 'Kills', damage: 'Damage', assists: 'Assists',
  trophies: 'Trophies', newBest: 'New best!', levelUp: 'Level up!', mvp: 'MVP', unlocked: 'New skin: {name}',
  quality: 'Graphics', auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High', sfx: 'Sound FX', music: 'Music', vibration: 'Vibration',
  leftHanded: 'Left-handed', stickSize: 'Joystick size', stickOpacity: 'Joystick opacity', aimSens: 'Aim sensitivity', uiScale: 'UI scale',
  colorblind: 'Colorblind mode', language: 'Language', showStats: 'Show performance', all: 'All-time', weekly: 'Weekly', byChar: 'By brawler', noRecords: 'No records yet. Play a match!',
  pause: 'Paused', resume: 'Resume', quit: 'Quit', rotate: 'Rotate your device!', rotateSub: 'It plays better in landscape',
  double: 'Double kill!', triple: 'Triple kill!', mega: 'Mega kill!', bounty: 'Bounty claimed! +150', poison: 'The poison cloud is closing in!', crownYou: 'You wear the crown!',
  ev_flowers: 'Healing flowers bloom!', ev_supply: 'Supply drop incoming!', ev_wind: 'Gusty winds! Shots curve', ev_soon: 'in 3s',
  superReady: 'Super ready!', hidden: 'Hidden', go: 'GO!', nickname: 'Nickname', level: 'Lv.', loading: 'Loading…',
  tut1: 'Move with the joystick (WASD)', tut2: 'Hit the dummy with Attack (click)', tut3: 'Hide in a bush — enemies can’t see you!',
  tut4: 'Super charged! Break a rock with your Super', tut5: 'Perfect! Now for a real match!', tutSkip: 'Skip', tutStart: 'Try the tutorial?',
  tutStartSub: 'Only takes 30 seconds', yes: 'Sure', later: 'Later', wins: 'Wins', games: 'Games', best: 'Best',
  controlsPc: 'WASD move · Mouse aim · Click attack · E/Right-click super · Space gadget · T emote · Tab scores',
  online: 'Online', myRecords: 'My records', onlineAll: '🌐 All-time', onlineWeekly: '🌐 Weekly', onlineChar: '🌐 {name}', lbOffline: 'Can’t reach the online leaderboard. Showing your local records.', lbLoading: 'Loading leaderboard…', onlineRank: '🌐 Global #{n}', lbEmpty: 'No records yet. Grab the first #1!',
  map: 'Map', mapSelect: 'Choose a map', randomMap: 'Random', randomMapDesc: 'A different arena every match!', tapToPick: 'Tap to pick',
  emote0: '😆', emote1: '😠', emote2: 'GG', emote3: '❤️', spectating: 'Spectating {name}', exitMatch: 'Leave? This match counts as a loss.',
};

let lang: 'ko' | 'en' = 'ko';
export const setLang = (l: 'ko' | 'en') => { lang = l; document.documentElement.lang = l; };
export const getLang = () => lang;
export function t(key: string, vars?: Record<string, string | number>) {
  let s = (lang === 'ko' ? ko : en)[key] ?? ko[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
