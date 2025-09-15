// Simple deterministic pseudo-random generator for stable mocks
let seed = 42;
function rand() {
  seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; // xorshift32
  // Convert to 0..1
  return ((seed >>> 0) % 1000) / 1000;
}

const names = [
  '张三','李四','王五','赵六','钱七','孙八','周九','吴十','郑一','冯二',
  '陈三','褚四','卫五','蒋六','沈七','韩八','杨九','朱十','秦一','尤二',
  '许三','何四','吕五','施六','张强','李雷','王刚','赵云','马超','黄忠',
];

const positions = ['工程师','技术员','值班员','调度员','班长','主管'];
const rooms = ['A101','A203','B110','C305','D210','E402'];
const depts = ['运行部','维护部','安全部','设备部'];
const shifts = ['白班','中班','夜班'];

function randDigit() { return String(Math.floor(rand() * 10) % 10); }
function buildPhone() {
  // 以 1 开头的 11 位号码，简单掩码
  const prefix = '1' + (3 + Math.floor(rand() * 6)); // 13x~18x
  const mid = Array.from({length: 4}, randDigit).join('');
  const tail = Array.from({length: 4}, randDigit).join('');
  return `${prefix}${mid}${tail}`;
}

// Build expected 80, arrived 74, notArrived 6
const expectedCount = 80;
// 调整到 72 人已到，未到 8 人（便于演示滚动）
const arrivedCount = 72;
const notArrivedCount = expectedCount - arrivedCount; // 6

function pick(arr) { return arr[Math.floor(rand() * arr.length) % arr.length]; }

const peopleExpected = Array.from({ length: expectedCount }).map((_, i) => {
  const group = i % 2 === 0 ? 1 : 2;
  return {
    id: i + 1,
    name: pick(names),
    group,
    position: pick(positions),
    room: pick(rooms),
    dept: pick(depts),
    shift: pick(shifts),
    phone: buildPhone(),
    // 使用本地公共目录中的默认头像，确保离线可用
    avatar: '/avatars/default.png',
  };
});

export const peopleArrived = peopleExpected.slice(0, arrivedCount);
export const peopleNotArrived = peopleExpected.slice(arrivedCount, arrivedCount + notArrivedCount);

// Simulate small latency
export function delay(ms = 300) {
  return new Promise((r) => setTimeout(r, ms));
}
