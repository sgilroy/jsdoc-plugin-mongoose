const _ = require('lodash');
const commentParser = require('comment-parser');

function getParentSchema(node) {
  if (
    node.parent &&
    node.parent.type === 'ObjectExpression' &&
    node.parent.parent
  ) {
    let pathItems = [node.key.name];
    let currentNode = node.parent.parent;
    let nested = false;
    while (currentNode) {
      if (isNewSchemaExpression(currentNode)) {
        const className = getSchemaClassName(currentNode);
        if (!className) {
          return;
        }
        return {
          className,
          path: pathItems.join('.'),
          memberNode: currentNode,
          nested
        };
      } else if (
        currentNode.type === 'Property' &&
        currentNode.parent &&
        currentNode.parent.type === 'ObjectExpression' &&
        currentNode.parent.parent
      ) {
        nested = true;
        pathItems.unshift(currentNode.key.name);
        currentNode = currentNode.parent.parent;
      } else {
        currentNode = undefined;
      }
    }
  }
}

function isNewSchemaExpression(node, orCalleeObject) {
  function hasCalleeMongooseSchema(node) {
    const callee = node.callee;
    return (
      callee &&
      callee.type === 'MemberExpression' &&
      ((node.type === 'NewExpression' &&
        callee.object.name === 'mongoose' &&
        callee.property.name === 'Schema') ||
        (orCalleeObject && hasCalleeMongooseSchema(callee.object)))
    );
  }

  return hasCalleeMongooseSchema(node);
}

function getClassNameFromSchemaName(schemaName) {
  const classNameMatch = schemaName.match(/([A-Z].*)Schema/);
  if (!classNameMatch) {
    return;
  }
  return classNameMatch[1];
}

function getSchemaClassName(node) {
  let schemaVariableDeclarator;
  let currentNode = node.parent;
  while (currentNode && !schemaVariableDeclarator) {
    if (currentNode && isSchemaVariableDeclaration(currentNode)) {
      // found the schema variable
      schemaVariableDeclarator = currentNode;
    } else if (
      currentNode.type === 'MemberExpression' &&
      currentNode.parent &&
      currentNode.parent.type === 'CallExpression' &&
      currentNode.parent.parent
    ) {
      currentNode = currentNode.parent.parent;
    } else {
      // bail, not found
      currentNode = undefined;
    }
  }
  if (!schemaVariableDeclarator) {
    return;
  }
  const schemaName = _.get(schemaVariableDeclarator, ['id', 'name']);
  if (!schemaName) {
    return;
  }
  return getClassNameFromSchemaName(schemaName);
}

function getFieldType(typeNode) {
  if (typeNode.type === 'ObjectExpression') {
    return recursiveGetFieldType(typeNode);
  }
  // such as `type: mongoose.Types.ObjectId` -> ObjectId or `type: 'String'` -> String
  const typePath =
    typeNode.type === 'MemberExpression' ? ['property', 'name'] : ['name'];
  const fieldType = _.get(typeNode, typePath);

  if (!fieldType) {
    return 'Object';
  }

  // if the type matches *Schema, drop the Schema part
  return getClassNameFromSchemaName(fieldType) || fieldType;
}

function getArrayType(typeNode) {
  return `Array<${getFieldType(typeNode.elements[0])}>`;
}

function recursiveGetFieldType(valueNode) {
  let fieldType;
  if (valueNode.type === 'ArrayExpression') {
    fieldType = getArrayType(valueNode);
  } else if (valueNode.type === 'ObjectExpression') {
    const typePropertyNode = _.find(valueNode.properties, {
      key: {name: 'type'}
    });
    const typeNode = _.get(typePropertyNode, ['value']);
    if (typeNode) {
      if (typeNode.type === 'ArrayExpression') {
        fieldType = getArrayType(typeNode);
      } else {
        fieldType = getFieldType(typeNode);
      }
    } else {
      fieldType = 'Object';
    }
  } else {
    fieldType = getFieldType(valueNode);
  }
  return fieldType;
}

function isSchemaVariableDeclaration(node) {
  return (
    node.type === 'VariableDeclarator' &&
    node.init &&
    isNewSchemaExpression(node.init, true)
  );
}

function findCommentWithTag(commentItems, tag) {
  return _.find(commentItems, item => _.find(item.tags, {tag: tag}));
}

exports.astNodeVisitor = {
  visitNode: function(node, e, parser, currentSourceName) {
    const schemaVariableDeclaration = isSchemaVariableDeclaration(node);

    function addComment(commentSources) {
      e.event = 'jsdocCommentFound';
      e.comment = commentSources.join('\n');
      e.filename = currentSourceName;
      e.lineno = node.loc.start.line;
    }

    if (schemaVariableDeclaration) {
      const className = getSchemaClassName(node.init);
      if (!className) {
        return;
      }

      // fallback to using the leading comment from the node if no JSDoc comment is available
      const leadingComments = _.get(
        node,
        'declarations[0].leadingComments[0].value'
      );
      const commentSources = commentParser(
        e.comment || (leadingComments && `/*${leadingComments}*/`) || ''
      ).map(item => item.source);
      commentSources.push(`@class ${className}`);
      commentSources.push('@extends mongoose.Model');
      addComment(commentSources);
    } else if (node.type === 'Property') {
      const parentSchema = getParentSchema(node);
      if (parentSchema) {
        let fieldType = recursiveGetFieldType(node.value);
        const commentSources = commentParser(e.comment).map(
          item => item.source
        );
        if (parentSchema.nested) {
          // nested node is a property of a member of a mongoose schema, so move the comment to be a @property
          delete e.comment;
          delete e.event;
          let memberCommentItems = commentParser(
            parentSchema.memberNode.comment || ''
          );
          const memberCommentSources = memberCommentItems.map(
            item => item.source
          );
          if (
            !_.find(memberCommentItems, item =>
              _.find(item.tags, {tag: 'property'})
            )
          ) {
            memberCommentSources.push(
              `@property {${fieldType}} ${
                parentSchema.path
              } ${commentSources.join(' ')}`
            );
            parentSchema.memberNode.comment = memberCommentSources.join('\n');
          }
        } else {
          if (parentSchema.className) {
            commentSources.push(`@memberof ${parentSchema.className}#`);
          }
          if (fieldType) {
            commentSources.push(`@member {${fieldType}} ${parentSchema.path}`);
          } else {
            commentSources.push(`@member ${parentSchema.path}`);
          }
          commentSources.push('');
          addComment(commentSources);
        }
      }
    } else if (
      node.type === 'AssignmentExpression' &&
      node &&
      node.left &&
      node.left.type === 'MemberExpression' &&
      node.left.object &&
      node.left.object.property &&
      node.left.object.object &&
      node.left.object.object.type === 'Identifier'
    ) {
      const className = getClassNameFromSchemaName(
        node.left.object.object.name
      );
      if (!className) {
        return;
      }
      const schemaPropertyName = node.left.object.property.name;
      if (!schemaPropertyName) {
        return;
      }

      // fallback to using the leading comment from the node if no JSDoc comment is available
      const leadingComments = _.get(
        node,
        'declarations[0].leadingComments[0].value'
      );
      let commentItems = commentParser(
        e.comment || (leadingComments && `/*${leadingComments}*/`) || ''
      );
      const commentSources = commentItems.map(item => item.source);
      if (!findCommentWithTag(commentItems, 'memberof')) {
        commentSources.push(
          `@memberof ${className}${schemaPropertyName === 'methods' ? '#' : ''}`
        );
      }
      if (
        !findCommentWithTag(commentItems, 'function') &&
        !findCommentWithTag(commentItems, 'member')
      ) {
        if (node.right.type === 'FunctionExpression') {
          commentSources.push(`@function ${node.left.property.name}`);
        } else {
          commentSources.push(`@member ${node.left.property.name}`);
        }
      }
      addComment(commentSources);
    }
  }
};
