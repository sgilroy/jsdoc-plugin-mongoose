const _ = require('lodash');
const commentParser = require('comment-parser');

function parseLeadingComments(currentNode) {
  const leadingComments = _.get(currentNode, 'leadingComments[0].value');
  return commentParser((leadingComments && `/*${leadingComments}*/`) || '');
}

function getSchemaOfTag(currentNode) {
  const parsed = parseLeadingComments(currentNode);
  const schemaOfComment = findCommentWithTag(parsed, 'schemaof');
  if (!schemaOfComment) {
    return;
  }
  const schemaOfTag = _.find(schemaOfComment.tags, {tag: 'schemaof'});
  return schemaOfTag.name;
}

function getParentSchema(node) {
  if (
    node.parent &&
    node.parent.type === 'ObjectExpression' &&
    node.parent.parent
  ) {
    const memberNode = node.parent.parent;
    if (isNewSchemaExpression(memberNode)) {
      const className = getSchemaClassName(memberNode);
      if (!className) {
        return;
      }
      return {
        className,
        path: node.key.name,
        memberNode
      };
    } else if (getSchemaOfTag(memberNode)) {
      const schemaOf = getSchemaOfTag(memberNode);
      return {
        className: schemaOf,
        path: node.key.name,
        memberNode
      };
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

function getNestedProperties(node, propertiesAccumulator, parentPath) {
  if (!node || !node.properties) {
    return;
  }

  const optionsSpecified = _.find(
    node.properties,
    property =>
      _.get(property, 'key.name') === 'type' &&
      property.value.type === 'ObjectExpression'
  );
  const typeProperties = optionsSpecified
    ? optionsSpecified.value.properties
    : node.properties;

  // iterate over properties of the node, adding each mongoose property to the properties array
  for (let propertyNode of typeProperties) {
    if (!(propertyNode.type === 'Property' && propertyNode.value)) {
      continue;
    }
    const fieldType = recursiveGetFieldType(propertyNode.value);
    if (!fieldType) {
      continue;
    }
    const name = propertyNode.key.name;
    const parsed = parseLeadingComments(propertyNode);
    const description = parsed
      .map(parsedItem => parsedItem.description)
      .join('\n');
    const path = parentPath ? parentPath + '.' + name : name;
    propertiesAccumulator.push({
      path,
      fieldType,
      description
    });
    if (fieldType === 'Object') {
      getNestedProperties(propertyNode.value, propertiesAccumulator, path);
    } else if (fieldType === 'Array<Object>') {
      getNestedProperties(
        _.get(propertyNode, 'value.elements[0]'),
        propertiesAccumulator,
        path
      );
    }
  }
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
      const leadingComments = _.get(node, 'leadingComments[0].value');
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
        const commentSources = commentParser(e.comment || '').map(
          item => item.source
        );

        if (parentSchema.className) {
          commentSources.push(`@memberof ${parentSchema.className}#`);
        }
        if (fieldType) {
          commentSources.push(`@member {${fieldType}} ${parentSchema.path}`);
        } else {
          commentSources.push(`@member ${parentSchema.path}`);
        }

        const properties = [];
        if (fieldType === 'Object') {
          getNestedProperties(node.value, properties);
        } else if (fieldType === 'Array<Object>') {
          getNestedProperties(_.get(node, 'value.elements[0]'), properties);
        }
        properties.forEach(property =>
          commentSources.push(
            `@property {${property.fieldType}} ${property.path} ${
              property.description
            }`
          )
        );

        addComment(commentSources);
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
      // member (statics or methods) of the schema
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
        if (
          node.right.type === 'FunctionExpression' ||
          node.right.type === 'ArrowFunctionExpression'
        ) {
          commentSources.push(`@function ${node.left.property.name}`);
        } else {
          commentSources.push(`@member ${node.left.property.name}`);
        }
      }
      addComment(commentSources);
    }
  }
};
