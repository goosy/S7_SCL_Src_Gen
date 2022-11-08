import { posix } from 'path';
import { readdir, readFile } from 'fs/promises';
import { context, write_file } from './src/util.js';
import { convert } from 'gooconverter';
import { rollup } from 'rollup';
import pkg from './package.json' assert { type: 'json' };
import { builtinModules } from 'module';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const mainInputOptions = {
    input: './src/index.js',
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
    ],
    external: [...builtinModules, 'iconv-lite', '**/package.json'],
};

const mainOutputOptionsList = [{
    file: pkg.exports['.'][0].import,
    format: 'es',
}];

const CLIInputOptions = {
    input: './src/cli.js',
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
    ],
    external: [...builtinModules, './index.js'],
};

const CLIOutputOptionsList = [{
    file: pkg.bin.s7scl,
    format: 'es',
    banner: '#!/usr/bin/env node',
}];

function get_module_path(...filename) {
    return posix.join(context.module_path, ...filename);
}

async function build() {
    // create fake src/symbols_buildin.yaml
    await write_file(get_module_path('src', 'symbols_buildin.yaml'), '');

    const files = await readdir(get_module_path('src', 'converters'));
    const types = files.filter(file => file.endsWith('.js')).map(file => file.replace(/\.js$/, ''));
    const converters = {};
    for (const type of types) {
        converters[type] = await import(`./src/converters/${type}.js`);
    }
    const supported_category = types.map(type =>
        ({ type, platforms: JSON.stringify(converters[type].platforms) })
    );

    // build src/symbols_buildin.yaml
    const yamls = [];
    for (const [type, converter] of Object.entries(converters)) {
        if (files.includes(`${type}.yaml`)) {
            const yaml_raw = await readFile(get_module_path('src', 'converters', `${type}.yaml`), { encoding: 'utf8' });
            const yaml = convert(converters[type], yaml_raw.trim());
            yamls.push(`---\nname: BUILDIN\ntype: ${type}\nsymbols: \n${yaml}\n...`);
        } else if (converter.BUILDIN) {
            yamls.push(`---\nname: BUILDIN\ntype: ${type}\nsymbols: \n${converter.BUILDIN.trim()}\n...`);
        }
    }
    await write_file(
        get_module_path('src', 'symbols_buildin.yaml'),
        yamls.join('\n\n'),
        { encoding: 'utf8' }
    );
    console.log(`file src / symbols_buildin.yaml generated!`);
    await write_file(
        get_module_path('lib', 'symbols_buildin.yaml'),
        yamls.join('\n\n'),
        { encoding: 'utf8' }
    );
    console.log(`file lib / symbols_buildin.yaml generated!`);

    // build src/converter.js
    await write_file(
        get_module_path('src', 'converter.js'),
        convert( // convert the content of src/converter.template
            { converters, supported_category },
            await readFile('src/converter.template', { encoding: 'utf8' })
        ),
        { encoding: 'utf8' }
    );
    console.log(`file src / converter.js generated!`);

    // build bundle files
    let main_bundle, cli_bundle;
    let buildFailed = false;
    try {
        main_bundle = await rollup(mainInputOptions);
        await generateOutputs(main_bundle, mainOutputOptionsList);
        cli_bundle = await rollup(CLIInputOptions);
        await generateOutputs(cli_bundle, CLIOutputOptionsList);
    } catch (error) {
        buildFailed = true;
        // do some error reporting
        console.error(error);
    }
    if (main_bundle) await main_bundle.close();
    if (cli_bundle) await cli_bundle.close();
    process.exit(buildFailed ? 1 : 0);
}

async function generateOutputs(bundle, outputOptionsList) {
    for (const outputOptions of outputOptionsList) {
        await bundle.write(outputOptions);
        console.log(`file ${outputOptions.file} generated!`);
    }
}

build();
