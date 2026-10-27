import ts from 'typescript';

function initializerExpression(expression) {
  while (
    expression &&
    (ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression))
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isFunctionInitializer(expression) {
  const value = initializerExpression(expression);
  return (
    value !== undefined &&
    (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isClassExpression(value))
  );
}

function isAmbient(statement) {
  return (
    ts.canHaveModifiers(statement) &&
    ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
  );
}

function isModuleMetadata(statement) {
  if (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return true;
  }
  if (ts.isExportAssignment(statement)) {
    return ts.isIdentifier(initializerExpression(statement.expression));
  }
  if (ts.isModuleDeclaration(statement)) {
    return isAmbient(statement) || (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
  }
  return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
}

/**
 * Diagnose module declarations outside the type, constant, state and implementation groups.
 * Const factory calls and callback-bearing objects remain data declarations; only direct
 * function/class initializers start implementation. Function bodies, class members and ambient
 * namespaces are not inspected, and the caller owns source-path and generated-file selection.
 * @param {import('typescript').SourceFile} source Parsed TypeScript or TSX source.
 * @returns {{ line: number, column: number, message: string }[]} Ordered source diagnostics.
 */
export function declarationOrderViolations(source) {
  const failures = [];
  let phase = 0;

  function report(node, message) {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    failures.push({ line: position.line + 1, column: position.character + 1, message });
  }

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      if (phase > 0) {
        report(statement, '模块级 type/interface 必须集中在常量、状态初始化和实现之前');
      }
      continue;
    }
    if (isModuleMetadata(statement) || isAmbient(statement)) continue;

    if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList;
      if ((declarations.flags & ts.NodeFlags.Using) !== 0) {
        phase = 3;
        continue;
      }
      const constant = (declarations.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of declarations.declarations) {
        if (constant && isFunctionInitializer(declaration.initializer)) {
          phase = 3;
        } else if (constant) {
          if (phase > 1) {
            report(declaration, '模块级非函数 const 必须集中在类型之后、模块状态和实现之前');
          }
          phase = Math.max(phase, 1);
        } else {
          if (phase > 2) {
            report(declaration, '模块级 let/var 状态必须集中在常量之后、实现之前');
          }
          phase = Math.max(phase, 2);
        }
      }
      continue;
    }

    phase = 3;
  }
  return failures;
}
