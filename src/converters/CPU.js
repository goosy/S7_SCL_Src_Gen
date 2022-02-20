import assert from 'assert/strict';
import { add_symbols, get_S7_symbol } from '../symbols.js';

export const CPU_NAME = 'CPU';
export const CPU_BUILDIN = [
    // ['Clock_Memory', 'MB0', , 'clock memory'],
    ['Clock_Memory', 'MB0'],
    ['Pulse_10Hz', 'M0.0'],
    ['Pulse_5Hz', 'M0.1'],
    ['Pulse_2.5Hz', 'M0.2'],
    ['Pulse_2Hz', 'M0.3'],
    ['Pulse_1.25Hz', 'M0.4'],
    ['Pulse_1Hz', 'M0.5'],
    ['Pulse_0.62Hz', 'M0.6'],
    ['Pulse_0.5Hz', 'M0.7'],
];

const CPU_type = [
    "IM151-8PN/DP",
    "CPU31x-2PN/DP",
    "CPU314C-2PN/DP",
    "CPU317-2PN/DP",
    "IM154-8PN/DP",
    "CPU319-3PN/DP",
    "CPU315T-3PN/DP",
    "CPU317T-3PN/DP",
    "CPU317TF-3PN/DP",
    "CPU412-2PN",
    "CPU414-3PN/DP",
    "CPU416-3PN/DP",
    "CPU412-5H_PN/DP",
    "CPU414-5H_PN/DP",
    "CPU416-5H_PN/DP",
    "CPU417-5H_PN/DP",
    "CPU410-5H",
];
const DEFAULT_DEVICE = "CPU31x-2PN/DP"; //默认的CPU设备

export function is_type_CPU(type) {
    return type.toUpperCase() === 'CPU';
}

const template_CPU = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
`;

const template_symbols = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;

/**
 * 第一遍扫描 提取符号
 * @date 2022-02-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols_CPU(CPU_area) {
    const symbols_dict = CPU_area.CPU.symbols_dict;
    const CM_addr = symbols_dict['Clock_Memory'].addr;
    assert(/^mb\d+$/i.test(CM_addr), new SyntaxError(`Clock_Memory 符号 "${CM_addr}" 无效！`));
    if (CM_addr != 'MB0') { // 内置符号改变
        const symbols = CPU_BUILDIN.slice(1).map(symbol_raw => {
            const ret = [...symbol_raw];
            const prefix = CM_addr.replace(/B/i,'').toUpperCase();
            ret[1] = ret[1].replace('M0', prefix);
            return ret;
        });
        add_symbols(symbols_dict, symbols);
    }
}

export function build_CPU({ CPU, options = {} }) {
    if (options.output_dir) CPU.output_dir = options.output_dir;
}

export function gen_CPU(CPU_list) {
    const CPU_rules = [];
    const symbols_rules = [];
    CPU_list.forEach(({ CPU, includes, options = {} }) => {
        const { name, output_dir } = CPU;
        const { output_file } = options;
        if (includes.length) CPU_rules.push({
            "name": `${output_dir}/${output_file ?? CPU_NAME}.scl`,
            "tags": {
                name,
                includes,
            }
        });
        const symbol_list = Object.values(CPU.symbols_dict).map(get_S7_symbol);
        if (symbol_list.length) symbols_rules.push({
            "name": `${output_dir}/${output_file ?? 'symbols'}.asc`,
            "tags": { symbol_list }
        });
    });
    return [
        { rules: CPU_rules, template: template_CPU },
        { rules: symbols_rules, template: template_symbols }
    ];
}

export function gen_CPU_copy_list() {
    return [];
}
