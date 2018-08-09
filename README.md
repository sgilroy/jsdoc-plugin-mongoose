## jsdoc-plugin-mongoose

[![Build Status](https://img.shields.io/travis/sgilroy/jsdoc-plugin-mongoose.svg?style=flat-square)](https://travis-ci.org/sgilroy/jsdoc-plugin-mongoose) [![Code Style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

This repository contains a [JSDoc]() plugin for use with [Mongoose](http://mongoosejs.com/).

This plugin will automatically generate JSDoc documentation from Mongoose schemas for corresponding models,
including data types of fields and contextual descriptions.

### Example

Given a Mongoose schema, defined as below, appropriate documentation will be generated.

```js
const mongoose = require('mongoose');

/**
 * Blog post
 */
const BlogSchema = new mongoose.Schema({
  /**
   * Title of the blog post which will be used as the header.
   */
  title:  String,
  /**
   * Array of comments, each with a body and date.
   */
  comments: [{ body: String, date: Date }],
  date: { type: Date, default: Date.now },
  hidden: Boolean
});

/**
 * Adds a comment to a blog post.
 * @param {String} body The body of the comment
 */
BlogSchema.methods.addComment = function(body) {
};

/**
 * Finds blog posts from today.
 */
BlogSchema.statics.findCurrentBlogPosts = function() {
};

module.exports = mongoose.model('Blog', BlogSchema);
```

The resulting documentation will include top-level schema paths as members of the inferred class:
>### Class: Blog
>Blog post
>
>#### Extends
> mongoose.Model
>
>#### Members
>
>##### comments :Array.<Object>
>Array of comments, each with a body and date.
>
>##### date :Date
>
>##### hidden :Boolean
>
>##### title :String
>Title of the blog post which will be used as the header.
>
>### Methods
>##### <static> findCurrentBlogPosts()
>Finds blog posts from today.
>
>##### addComment(body)
>Adds a comment to a blog post.

### Usage

To use this plugin, include it as one of the plugins in your JSDoc configuration.
Uses of `new mongoose.Schema` in your code will be detected and result in documentation being
generated for the corresponding model and its members (see example above).

1. Install this plugin globally or as a dev dependency, or copy it to the `plugins` folder located in the JSDoc installation folder.
    ```bash
    $ git clone https://github.com/sgilroy/jsdoc-plugin-mongoose
    ```                                                                      
2. Include the plugin in your jsdoc-conf.js file. If the plugin is not installed in the `plugins` folder, specify a relative or absolute path to the plugin.
    ```js
    module.exports = {
        plugins: ['plugins/jsdoc-plugin-mongoose']
    }
    ```                                                                      
3. Run JSDoc from the command line and pass the configuration file to it.
    ```bash
    $ jsdoc -c jsdoc-conf.js
    ```