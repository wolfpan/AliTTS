// 进程运行时状态：与 config（期望值）区分，用于提示“改了配置需重启”
const os = require('os');

const state = { host: null, port: null };

function set(host, port) {
  state.host = host;
  state.port = port;
}

function get() {
  return { host: state.host, port: state.port };
}

// 本机所有局域网 IPv4 地址（排除回环），供设置页展示给其他设备访问
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        out.push(`http://${ni.address}:${state.port || 3210}`);
      }
    }
  }
  return out;
}

module.exports = { set, get, lanUrls };
