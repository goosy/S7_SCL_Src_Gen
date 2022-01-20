import { dump, load, loadAll } from "js-yaml";
import { readdir, writeFile } from 'fs/promises';
import { gen_symbols, build_symbols, add_symbols, buildin_symbols } from './symbols.js';
import { IntIncHL, S7IncHL, read_file } from './util.js';
import { trace_info } from './trace_info.js'
import { join } from 'path';

// 目前支持的类型
const TYPES = ['CPU', 'AI', 'PI', 'SC', 'MT', 'valve', 'motor', 'alarm'];

// 引入所有的转换器
// 所有的转换器JS代码 必须实现
//   function if_type_<type>
//   function gen_<type>
// 可选实现
//   Array <type>_BUILDIN
//   function parse_symbols_<type> 
//   function gen_<type>_copy_list
const converter = { gen_symbols };
Object.assign(
  converter,
  ...await Promise.all(
    TYPES.map(async type => import(`./${type}.js`))
  )
);

// 重建内置符号
TYPES.forEach(type => {
  const buildin = converter[`${type.toUpperCase()}_BUILDIN`];
  if (buildin) buildin_symbols.push(...buildin);
});

const conf_list = {
  CPU: [],  // 通用列表 {CPU， includes, list, options}[]
  AI: [],      // 模拟量列表 {CPU， includes, list, options}[]
  PI: [],      // 模拟量列表 {CPU， includes, list, options}[]
  valve: [],   // 阀门列表 {CPU， includes, list, options}[]
  motor: [],   // 电机列表 {CPU， includes, list, options}[]
  alarm: [],   // 报警列表 {CPU， includes, list, options}[]
  MT: [],      // MT 列表 {CPU， includes, list, options}[]
  SC: [],      // 串行通信列表 {CPU， includes, list, options}[]
  symbols: [], // symbols 列表 {CPU， includes, list, options}[]
}

const CPUs = {}; // CPU 资源
function get_cpu(CPU_name) {
  // 如没有则建立一个初始资源数据
  return CPUs[CPU_name] ??= {
    name: CPU_name,
    conn_ID_list: new IntIncHL(16), // 已用连接ID列表
    DB_list: new IntIncHL(100),     // 已用数据块列表
    FB_list: new IntIncHL(256),     // 已用函数块列表
    FC_list: new IntIncHL(256),     // 已用函数列表
    UDT_list: new IntIncHL(256),    // 已用自定义类型列表
    poll_list: new IntIncHL(1),     // 已用查询号
    MA_list: new S7IncHL([0, 0]),   // 已用M地址
    IA_list: new S7IncHL([0, 0]),   // 已用I地址
    QA_list: new S7IncHL([0, 0]),   // 已用I地址
    symbols_dict: {},               // 符号表
    conn_host_list: {},             // 已用的连接地址列表
    output_dir: CPU_name,           // 输出文件夹
    push_conf(type, conf) {
      this[type] = conf;
    }
  }
}

async function fetch_includes(files) {
  if (typeof files == 'string') return files;
  if (!Array.isArray(files)) return '';
  let code = '';
  try {
    for (const file of files) {
      code += await read_file(file) + '\n';
    };
  } catch (err) {
    code = '';
    log.error(err.message);
  }
  return code;
}

// 第一遍扫描，仅提取符号
async function add_conf(conf) {
  // 检查重复
  const { name, CPU: CPU_name = name, type } = conf;
  if (typeof CPU_name !== 'string') throw new SyntaxError(' name(CPU) 必须提供!');
  trace_info.CPU = CPU_name;
  if (typeof type !== 'string') throw new SyntaxError(' type 必须提供!');
  const doctype = TYPES.find(t => converter[`is_type_${t}`](type));
  if (!doctype) {
    console.error(`${trace_info.filename}文件 ${CPU_name}:${type}文档 : 该类型转换系统不支持`);
    process.exit(1);
  }
  const CPU = get_cpu(CPU_name);
  if (doctype === 'CPU') CPU.device = conf.device;
  if (CPU[doctype]) {
    console.error(`${CPU_name}:${doctype}${doctype == type ? '(' + type + ')' : ''} 有重复的配置 has duplicate configurations`);
    process.exit(2);
  }
  CPU.push_conf(doctype, dump(conf)); // 按名称压入无注释配置文本
  trace_info.type = doctype;
  trace_info.push_doc();

  function parse_symbols_in_SCL(SCL) {
    const code = SCL.replace(/(^|\n)\s*\(\*(symbols:\s+[\s\S]*?)\*\)/g, (m, m1, yaml) => {
      const symbols = load(yaml)['symbols']?.map(symbol => {
        symbol[3] ??= 'symbol from files of includes';
        return symbol;
      })
      add_symbols(symbols_dict, symbols ?? []);
      return '';
    })
    return code;
  }

  // conf 存在属性为 null 但不是 undefined 的情况，故不能解构赋值
  const options = conf.options ?? {};
  const list = conf.list ?? [];
  const symbols = conf.symbols ?? [];
  const symbols_dict = CPU.symbols_dict;
  const loop_additional_code = await fetch_includes(conf.loop_additional_code);
  // 加入 includes 符号
  const includes = parse_symbols_in_SCL(await fetch_includes(conf.includes));
  // 加入内置符号
  const buildin = converter[`${doctype.toUpperCase()}_BUILDIN`];
  if (buildin) add_symbols(symbols_dict, buildin);
  // 加入前置符号
  add_symbols(symbols_dict, symbols);

  const area = { CPU, list, includes, loop_additional_code, options };
  const parse_symbols = converter[`parse_symbols_${doctype}`];
  if (typeof parse_symbols === 'function') parse_symbols(area);
  conf_list[doctype].push(area);
}

export async function gen_data({ output_zyml, noconvert }) {
  const work_path = process.cwd();

  // 第一遍扫描 加载配置\提取符号\建立诊断信息
  try {
    console.log('readding file:');
    for (const file of await readdir(work_path)) {
      if (/.*ya?ml$/i.test(file)) {
        const filename = join(work_path, file);
        trace_info.filename = filename;
        trace_info.doc_index = 0;
        const docs = loadAll(await read_file(filename));
        for (const [index, doc] of docs.entries()) {
          trace_info.doc_index = index + 1;
          await add_conf(doc);
        }
        console.log(`\t${filename}`);
      }
    }
    trace_info.clear();
  } catch (e) {
    console.log(e);
  }

  // 输出无注释配置
  if (output_zyml) {
    console.log('output the uncommented configuration file:');
    for (const [name, CPU] of Object.entries(CPUs)) {
      // 生成无注释的配置
      const yaml = TYPES.reduce(
        (docs, type) => CPU[type] ? `${docs}\n\n---\n${CPU[type]}...` : docs,
        `# CPU ${name} configuration`
      );
      const filename = `${join(work_path, name)}.zyml`;
      await writeFile(filename, yaml);
      console.log(`\t${filename}`);
    }
  }

  // 第二遍扫描 补全数据

  // 检查并补全符号表
  for (const CPU of Object.values(CPUs)) {
    const symbol_conf = build_symbols(CPU);
    conf_list.symbols.push(symbol_conf)
  }

  for (const [type, list] of Object.entries(conf_list)) {
    const build = converter['build_' + type];
    if (typeof build === 'function') list.forEach(build);
  };

  // 校验完毕，由 noconvert 变量决定是否输出
  if (noconvert) return [[], []];

  // 第三遍扫描 生成最终待转换数据
  const copy_list = [];
  TYPES.forEach(type => {
    for (const item of conf_list[type]) {
      const gen = converter[`gen_${type}_copy_list`];
      if (typeof gen !== 'function') return;
      let ret = gen(item);
      ret = Array.isArray(ret) ? ret : [ret];
      copy_list.push(...ret);
    }
  })

  const convert_list = [...TYPES, 'symbols'].map(type => {
    const gen = converter['gen_' + type];
    return gen(conf_list[type])
  });
  return [copy_list, convert_list];
}
