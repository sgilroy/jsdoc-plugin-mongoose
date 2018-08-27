const plugin = require('../../index');

it('should do nothing for an empty node', () => {
  const node = {},
    e = {};
  plugin.astNodeVisitor.visitNode(node, e);
  expect(e).not.toHaveProperty('event');
});

describe('with mongoose.Schema', function() {
  let schemaNode;

  beforeEach(function() {
    schemaNode = {
      type: 'VariableDeclarator',
      init: {
        type: 'NewExpression',
        callee: {
          type: 'MemberExpression',
          object: {name: 'mongoose'},
          property: {name: 'Schema'}
        }
      },
      id: {
        name: 'BlogSchema'
      },
      loc: {
        start: {
          line: 10
        }
      }
    };
    schemaNode.init.parent = schemaNode;
  });

  it('should add class documentation', () => {
    const e = {};
    plugin.astNodeVisitor.visitNode(schemaNode, e);
    expect(e).toHaveProperty('event');
    expect(e).toHaveProperty('comment', '@class Blog\n@extends mongoose.Model');
  });

  it('should add member documentation to schema path', () => {
    const node = {
        type: 'Property',
        key: {
          name: 'title'
        },
        value: {
          name: 'String'
        },
        parent: {
          type: 'ObjectExpression',
          parent: schemaNode.init
        },
        loc: {
          start: {
            line: 15
          }
        }
      },
      e = {};
    plugin.astNodeVisitor.visitNode(node, e);
    expect(e).toHaveProperty('event');
    expect(e).toHaveProperty(
      'comment',
      '@memberof Blog#\n@member {String} title'
    );
  });
});
