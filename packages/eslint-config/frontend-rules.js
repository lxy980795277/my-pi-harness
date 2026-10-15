/** Project-specific React and Zustand rules for handwritten Renderer source. */
const walk = (node, sourceCode, visit) => {
  if (!node) return;
  visit(node);
  for (const key of sourceCode.visitorKeys[node.type] ?? []) {
    const value = node[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child?.type) walk(child, sourceCode, visit);
    }
  }
};

const containsJsx = (node, sourceCode) => {
  let found = false;
  walk(node, sourceCode, (child) => {
    if (child.type === 'JSXElement' || child.type === 'JSXFragment') found = true;
  });
  return found;
};

const isFc = (annotation) => {
  const type = annotation?.typeAnnotation;
  if (type?.type !== 'TSTypeReference') return false;
  const name = type.typeName;
  return (
    (name.type === 'Identifier' && name.name === 'FC') ||
    (name.type === 'TSQualifiedName' && name.left.name === 'React' && name.right.name === 'FC')
  );
};

const storeName = (node) => {
  return node?.type === 'Identifier' && /^use[A-Z].*Store$/.test(node.name);
};

const memberName = (node) => {
  return node.computed ? node.property.value : node.property.name;
};

const componentInitializer = (node) => {
  if (!node) return false;
  if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return true;
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  return (
    (callee.type === 'Identifier' && ['memo', 'forwardRef'].includes(callee.name)) ||
    (callee.type === 'MemberExpression' &&
      callee.object.name === 'React' &&
      ['memo', 'forwardRef'].includes(memberName(callee)))
  );
};

const returnsFreshValue = (selector, sourceCode) => {
  let fresh = false;
  const inspectValue = (node) => {
    if (!node) return;
    if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') fresh = true;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      ['map', 'filter', 'slice', 'concat', 'flat', 'flatMap'].includes(memberName(node.callee))
    ) {
      fresh = true;
    }
    if (node.type === 'LogicalExpression') {
      inspectValue(node.left);
      inspectValue(node.right);
    }
    if (node.type === 'ConditionalExpression') {
      inspectValue(node.consequent);
      inspectValue(node.alternate);
    }
  };
  if (selector.body.type !== 'BlockStatement') inspectValue(selector.body);
  else
    walk(selector.body, sourceCode, (node) => {
      if (node.type !== 'ReturnStatement') return;
      let owner = node.parent;
      while (owner && !['ArrowFunctionExpression', 'FunctionExpression'].includes(owner.type))
        owner = owner.parent;
      if (owner === selector) inspectValue(node.argument);
    });
  return fresh;
};

/** Rules expose deterministic checks; state ownership still requires code review. */
export const frontendPlugin = {
  rules: {
    'presentation-only': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          service: 'TSX 只组合界面；Service 和 Query 请求编排放到 .ts Hook。',
          control: '业务组件使用 components/ui 的 shadcn 控件，不直接使用原生交互控件。',
          handler: 'JSX 事件使用具名回调，事件处理放在组件函数或 .ts Hook 中。',
          transform: 'JSX map 回调只返回界面，选项计算和多步转换放到 .ts 函数。',
        },
      },
      create(context) {
        const filename = context.filename.replaceAll('\\', '/');
        if (!filename.endsWith('.tsx')) return {};
        const primitive = filename.includes('/src/components/ui/');
        const nativeControls = new Set([
          'button',
          'input',
          'textarea',
          'select',
          'option',
          'optgroup',
          'label',
          'fieldset',
          'legend',
        ]);
        return {
          ImportDeclaration(node) {
            if (node.importKind === 'type') return;
            const module = node.source.value;
            if (/(?:^|\/)services\//.test(module)) {
              if (
                node.specifiers.length === 0 ||
                node.specifiers.some((specifier) => specifier.importKind !== 'type')
              ) {
                context.report({ node, messageId: 'service' });
              }
            }
            if (module !== '@tanstack/react-query') return;
            for (const specifier of node.specifiers) {
              if (specifier.importKind === 'type') continue;
              const imported = specifier.imported?.name ?? specifier.imported?.value;
              if (specifier.type !== 'ImportSpecifier' || imported !== 'QueryClientProvider') {
                context.report({ node: specifier, messageId: 'service' });
              }
            }
          },
          JSXOpeningElement(node) {
            if (
              !primitive &&
              node.name.type === 'JSXIdentifier' &&
              nativeControls.has(node.name.name)
            ) {
              context.report({ node, messageId: 'control' });
            }
          },
          JSXAttribute(node) {
            if (!/^on[A-Z]/.test(node.name.name ?? '')) return;
            if (
              ['ArrowFunctionExpression', 'FunctionExpression'].includes(
                node.value?.expression?.type,
              )
            ) {
              context.report({ node, messageId: 'handler' });
            }
          },
          'JSXExpressionContainer CallExpression'(node) {
            if (node.callee.type !== 'MemberExpression' || memberName(node.callee) !== 'map')
              return;
            const callback = node.arguments[0];
            if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(callback?.type)) return;
            const body = callback.body;
            if (
              body.type === 'BlockStatement' &&
              (body.body.length !== 1 || body.body[0].type !== 'ReturnStatement')
            ) {
              context.report({ node: callback, messageId: 'transform' });
            }
          },
        };
      },
    },
    'transport-owner': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          http: 'HTTP 请求统一通过 services/base-request.ts。',
          sse: 'SSE 统一通过 services/base-sse.ts。',
        },
      },
      create(context) {
        const filename = context.filename.replaceAll('\\', '/');
        const name = (callee) => {
          if (callee.type === 'Identifier') return callee.name;
          if (
            callee.type === 'MemberExpression' &&
            ['window', 'globalThis'].includes(callee.object.name)
          )
            return memberName(callee);
          return undefined;
        };
        return {
          CallExpression(node) {
            if (
              name(node.callee) === 'fetch' &&
              !filename.endsWith('/src/services/base-request.ts')
            )
              context.report({ node, messageId: 'http' });
          },
          NewExpression(node) {
            if (
              name(node.callee) === 'EventSource' &&
              !filename.endsWith('/src/services/base-sse.ts')
            )
              context.report({ node, messageId: 'sse' });
          },
        };
      },
    },
    'component-declaration': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { component: '手写 React 组件使用 const Xxx: FC<Props>，公开组件具名导出。' },
      },
      create(context) {
        return {
          VariableDeclarator(node) {
            if (
              node.id.type === 'Identifier' &&
              /^[A-Z]/.test(node.id.name) &&
              componentInitializer(node.init) &&
              containsJsx(node.init, context.sourceCode) &&
              (node.parent.kind !== 'const' || !isFc(node.id.typeAnnotation))
            ) {
              context.report({ node, messageId: 'component' });
            }
          },
          FunctionDeclaration(node) {
            if (/^[A-Z]/.test(node.id?.name ?? '') && containsJsx(node.body, context.sourceCode)) {
              context.report({ node, messageId: 'component' });
            }
          },
          ClassDeclaration(node) {
            if (containsJsx(node.body, context.sourceCode)) {
              context.report({ node, messageId: 'component' });
            }
          },
        };
      },
    },
    'zustand-selector': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          selector: 'Store Hook 必须通过选择器订阅当前需要的值，不能返回整个 state。',
          fresh: '普通 Store 选择器不能创建新对象/数组；组合值使用 useShallow 或稳定引用。',
          snapshot: '组件与 Hook 使用选择器订阅，不直接调用 Store.getState()。',
          chain: 'Store 动作入口先命名 get() 快照，禁止 get().member 链式读取。',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type === 'MemberExpression' &&
              storeName(node.callee.object) &&
              memberName(node.callee) === 'getState' &&
              !context.filename.replaceAll('\\', '/').includes('/stores/')
            ) {
              context.report({ node, messageId: 'snapshot' });
            }
            if (!storeName(node.callee)) return;
            const selector = node.arguments[0];
            if (!selector) {
              context.report({ node, messageId: 'selector' });
              return;
            }
            if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(selector.type)) return;
            const parameter = selector.params[0];
            const body = selector.body;
            const returned =
              body.type === 'BlockStatement'
                ? body.body.find((statement) => statement.type === 'ReturnStatement')?.argument
                : body;
            if (
              parameter?.type === 'Identifier' &&
              returned?.type === 'Identifier' &&
              returned.name === parameter.name
            ) {
              context.report({ node: selector, messageId: 'selector' });
            } else if (returnsFreshValue(selector, context.sourceCode)) {
              context.report({ node: selector, messageId: 'fresh' });
            }
          },
          MemberExpression(node) {
            if (
              node.object.type === 'CallExpression' &&
              node.object.callee.type === 'Identifier' &&
              node.object.callee.name === 'get'
            ) {
              context.report({ node, messageId: 'chain' });
            }
          },
        };
      },
    },
  },
};
