import 'module-alias/register';
import c from 'ansi-colors';
import moment from 'moment-timezone';
// moment-timezone 扩展了 moment 类型，提供了 tz 方法
// 设置时区
moment.tz.setDefault('Asia/Shanghai');

export default function main() {
  console.log(c.bgGreen('Hello Bun'));
  console.log(moment().format());
}
main();
