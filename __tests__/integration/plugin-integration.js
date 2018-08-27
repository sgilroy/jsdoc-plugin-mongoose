const jsdocx = require('jsdoc-x');

function parseJsdoc(program) {
  const source = program.toString();
  return jsdocx.parse({
    plugins: ['index'],
    undocumented: false,
    source
  });
}

it('should do nothing for code with no mongoose schema', () => {
  return expect(
    parseJsdoc(() => {
      Math.abs(1);
    })
  ).resolves.toEqual([]);
});

describe('with mongoose.Schema', function() {
  it('should add class documentation', async () => {
    const results = await parseJsdoc(() => {
      const mongoose = require('mongoose');

      /**
       * Blog post
       */
      const BlogSchema = new mongoose.Schema({});
      mongoose.model('Blog', BlogSchema);
    });

    expect(results[0]).toHaveProperty(
      'comment',
      `Blog post
@class Blog
@extends mongoose.Model`
    );
  });

  it('should add member documentation to schema path', async () => {
    const results = await parseJsdoc(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({
        /**
         * Title of the blog post which will be used as the header.
         */
        title: String
      });
      mongoose.model('Blog', BlogSchema);
    });

    expect(results[1]).toHaveProperty(
      'comment',
      `Title of the blog post which will be used as the header.
@memberof Blog#
@member {String} title`
    );
  });

  it('should add function documentation to a static method', async () => {
    const results = await parseJsdoc(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({});
      /**
       * Finds blog posts from today.
       */
      BlogSchema.statics.findCurrentBlogPosts = function() {
        return mongoose.model('Blog').find();
      };
    });

    expect(results[1]).toHaveProperty(
      'comment',
      `Finds blog posts from today.
@memberof Blog
@function findCurrentBlogPosts`
    );
  });

  it('should add function documentation to a static arrow function method', async () => {
    const results = await parseJsdoc(() => {
      const mongoose = require('mongoose');

      const BlogSchema = new mongoose.Schema({});
      /**
       * Finds blog posts from today.
       */
      BlogSchema.statics.findCurrentBlogPosts = () => {
        return mongoose.model('Blog').find();
      };
    });

    expect(results[1]).toHaveProperty(
      'comment',
      `Finds blog posts from today.
@memberof Blog
@function findCurrentBlogPosts`
    );
  });
});
