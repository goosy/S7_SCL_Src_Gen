import { make_s7express } from '../symbols.js';
import { STRING } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = `Timer_Proc`;
export const LOOP_NAME = 'Timer_Loop';

export function is_feature(feature) {
    return feature.toLowerCase() === 'timer';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{#for timer in list}}
// {{timer.comment}}
"{{NAME}}".{{timer.DB.value}}({{#if timer.enable}}
    enable := {{timer.enable.value}},{{#endif}}{{#if timer.reset}}
    reset := {{timer.reset.value}},{{#endif}}{{#if timer.enable || timer.reset}}
    {{#endif}}PPS := {{timer.PPS.value}});
{{#endfor timer}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const timer = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const DB = node.get('DB');
        if (!DB) throw new SyntaxError("timer转换必须有DB块!");
        const comment = timer.comment.value;
        make_s7express(timer, 'DB', DB, document, { force: { type: NAME }, default: { comment } });

        const options = { s7express: true, force: { type: 'BOOL' } };
        make_s7express(timer, 'enable', node.get('enable'), document, options);
        make_s7express(timer, 'reset', node.get('reset'), document, options);
        make_s7express(timer, 'PPS', node.get('PPS') ?? "Pulse_1Hz", document, options);

        return timer;
    });
}

export function gen(timer_list) {
    const rules = [];
    timer_list.forEach(({ document, includes, loop_additional_code, list }) => {
        const { CPU, gcl } = document;
        const { output_dir } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                includes,
                loop_additional_code,
                NAME,
                LOOP_NAME,
                list,
                gcl,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const filename = `${NAME}.scl`;
    const src = posix.join(context.module_path, NAME, filename);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
    return [{ src, dst }];
}
