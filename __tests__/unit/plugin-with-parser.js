const _ = require('lodash');
const plugin = require('../../index');

/*
jsdoc does not provide an API to use it programmatically. As a workaround, these tests initialize jsdoc and then
with the help of some mocking by jest, use the internal jsdoc parser to build and walk the AST to simulate what
jsdoc does and allow the plugin to be tested.
*/

// TODO: mock args.parse to prevent unwanted console log from the subsequent require of jsdoc/jsdoc
// const args = require('jsdoc/opts/args');
// const argsParseMock = jest.spyOn(args, 'parse');
// argsParseMock.mockImplementation(() => {});

// Note that in order for these jest.mock and require statements to succeed, we need NODE_PATH=./node_modules/jsdoc/lib
jest.mock('jsdoc/env');
const envMock = require('jsdoc/env');

// require in order to initialize jsdoc
require('jsdoc/jsdoc');

// override the mocked env.conf with the conf initialized in the global env from the above require
/*eslint no-undef: "off"*/
envMock.conf = env.conf;

const jsdocParser = require('jsdoc/lib/jsdoc/src/parser');

const parser = jsdocParser.createParser();
const sourceName = 'fake.js';

/**
 * Exercise the visitNode method of the plugin by treating the program function as if it were a file with JSDoc
 * commented code and then passing the specified node to the plugin's visitNode method.
 *
 * @param {Function} program Function with a body of JSDoc commented code to test
 * @param {String} nodePath Relative path to the AST node that should be visited, specified from the body of the program function
 * @return {Object} Event object that results from the plugin visiting the node
 */
function visitNode(program, nodePath) {
  const source = program.toString();
  const ast = parser._astBuilder.build(source, sourceName);
  const events = [];
  let event = {};

  // find any existing jsdoc comment
  parser.on('jsdocCommentFound', _event => {
    events.push(_event);
  });

  // walk the AST to set the parent of each node
  parser._walkAst(ast, parser._visitor, sourceName);
  const node = _.get(ast, 'program.body[0].expression.body.' + nodePath);

  // make sure the specified nodePath is valid before proceeding
  expect(node).toBeDefined();

  // only include the event if its on on before the line of the node
  for (let _event of events) {
    if (_event.lineno <= node.loc.start.line) {
      event = _event;
    }
  }
  plugin.astNodeVisitor.visitNode(node, event);

  return event;
}

it('should do nothing for code with no mongoose schema', () => {
  const event = visitNode(() => {
    Math.abs(1);
  }, 'body[0]');
  expect(event).not.toHaveProperty('comment');
});

describe('with mongoose.Schema', function() {
  it('should add class documentation', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      /**
       * Blog post
       */
      const BlogSchema = new mongoose.Schema({});
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0]');

    expect(event).toHaveProperty(
      'comment',
      `Blog post
@class Blog
@extends mongoose.Model`
    );
  });

  it('should add member documentation to schema path', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        /**
         * Title of the blog post which will be used as the header.
         */
        title: String
      });
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0].init.arguments[0].properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `Title of the blog post which will be used as the header.
@memberof Blog#
@member {String} title`
    );
  });

  it('should include description and type for nested schema property', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        author: {
          /**
           * Name of the author
           */
          name: String,
          image: String
        }
      });
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0].init.arguments[0].properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `@memberof Blog#
@member {Object} author
@property {String} name Name of the author
@property {String} image `
    );
  });

  it('should include description and type for schema property nested in type object', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        author: {
          select: false,
          type: {
            /**
             * Name of the author
             */
            name: String,
            image: String
          }
        }
      });
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0].init.arguments[0].properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `@memberof Blog#
@member {Object} author
@property {String} name Name of the author
@property {String} image `
    );
  });

  it('should include description and type for nested array schema property', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        comments: [
          {
            /**
             * Body of the comment
             */
            body: String,
            author: String
          }
        ]
      });
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0].init.arguments[0].properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `@memberof Blog#
@member {Array<Object>} comments
@property {String} body Body of the comment
@property {String} author `
    );
  });

  it('should include description and type for deeply nested schema property', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        author: {
          image: {
            /**
             * Size of the image
             */
            size: String
          }
        }
      });
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0].init.arguments[0].properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `@memberof Blog#
@member {Object} author
@property {Object} image 
@property {String} image.size Size of the image`
    );
  });

  it('should include description and type for deeply nested array schema property', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        comments: [
          {
            replies: [
              {
                /**
                 * Body of the reply to the comment
                 */
                body: String
              }
            ]
          }
        ]
      });
      mongoose.model('Blog', BlogSchema);
    }, 'body[1].declarations[0].init.arguments[0].properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `@memberof Blog#
@member {Array<Object>} comments
@property {Array<Object>} replies 
@property {String} replies.body Body of the reply to the comment`
    );
  });

  it('should add function documentation to a static method', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({});
      /**
       * Finds blog posts from today.
       */
      BlogSchema.statics.findCurrentBlogPosts = function() {
        return mongoose.model('Blog').find();
      };
    }, 'body[2].expression');

    expect(event).toHaveProperty(
      'comment',
      `Finds blog posts from today.
@memberof Blog
@function findCurrentBlogPosts`
    );
  });

  it('should add function documentation to a static arrow function method', async () => {
    const event = visitNode(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({});
      /**
       * Finds blog posts from today.
       */
      BlogSchema.statics.findCurrentBlogPosts = () => {
        return mongoose.model('Blog').find();
      };
    }, 'body[2].expression');

    expect(event).toHaveProperty(
      'comment',
      `Finds blog posts from today.
@memberof Blog
@function findCurrentBlogPosts`
    );
  });
});

describe('@schemaof', function() {
  it('should add member documentation to schema path', async () => {
    const event = visitNode(() => {
      /**
       * @schemaof Blog
       */
      module.exports = {
        /**
         * Title of the blog post which will be used as the header.
         */
        title: String
      };
    }, 'body[0].expression.right.properties[0]');

    expect(event).toHaveProperty(
      'comment',
      `Title of the blog post which will be used as the header.
@memberof Blog#
@member {String} title`
    );
  });
});
