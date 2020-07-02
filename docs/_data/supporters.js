#!/usr/bin/env node
'use strict';

const {mkdirSync} = require('fs');
const {writeFile} = require('fs').promises;
const {resolve} = require('path');
const debug = require('debug')('mocha:docs:data:supporters');
const needle = require('needle');
const imageSize = require('image-size');
const fileType = require('file-type');
const blocklist = new Set(require('./blocklist.json'));

const API_ENDPOINT = 'https://api.opencollective.com/graphql/v2';

const query = `query account($limit: Int, $offset: Int, $slug: String) {
  account(slug: $slug) {
    orders(limit: $limit, offset: $offset) {
      limit
      offset
      totalCount
      nodes {
        fromAccount {
          id
          name
          slug
          website
          imgUrlMed: imageUrl(height:64)
          imgUrlSmall: imageUrl(height:32)
          type
        }
        totalDonations {
          value
        }
        createdAt
      }
    }
  }
}`;

const graphqlPageSize = 1000;

const nodeToSupporter = node => ({
  id: node.fromAccount.id,
  name: node.fromAccount.name,
  slug: node.fromAccount.slug,
  website: node.fromAccount.website,
  imgUrlMed: node.fromAccount.imgUrlMed,
  imgUrlSmall: node.fromAccount.imgUrlSmall,
  firstDonation: node.createdAt,
  totalDonations: node.totalDonations.value * 100,
  type: node.fromAccount.type
});

/**
 * Retrieves donation data from OC
 *
 * Handles pagination
 * @param {string} slug - Collective slug to get donation data from
 * @returns {Promise<Object[]>} Array of raw donation data
 */
const getAllOrders = async (slug = 'mochajs') => {
  let allOrders = [];
  const variables = {limit: graphqlPageSize, offset: 0, slug};

  // Handling pagination if necessary (2 pages for ~1400 results in May 2019)
  while (true) {
    const result = await needle(
      'post',
      API_ENDPOINT,
      {query, variables},
      {json: true}
    );
    const orders = result.body.data.account.orders.nodes;
    allOrders = [...allOrders, ...orders];
    variables.offset += graphqlPageSize;
    if (orders.length < graphqlPageSize) {
      debug('retrieved %d orders', allOrders.length);
      return allOrders;
    } else {
      debug(
        'loading page %d of orders...',
        Math.floor(variables.offset / graphqlPageSize)
      );
    }
  }
};

/**
 * Blank images from https://png-pixel.com/ for when OpenCollective
 * doesn't respond with a PNG image while downloading supporter avatars
 */
// 64x64 #f9f9f9 png
const blank64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAPElEQVR42u3OMQEAAAgDINc/sZfG2AMJyN5URUBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQKAdeHK9fkGpx7l4AAAAAElFTkSuQmCC',
  'base64'
);
// 32x32 #f9f9f9 png
const blank32 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAAAIUlEQVR42mP8+Z+BIsA4asCoAaMGjBowasCoAaMGDDcDAC5IPyHFDzg6AAAAAElFTkSuQmCC',
  'base64'
);

module.exports = async () => {
  const orders = await getAllOrders();
  // Deduplicating supporters with multiple orders
  const uniqueSupporters = new Map();

  const supporters = orders
    .map(nodeToSupporter)
    .filter(supporter => !blocklist.has(supporter.slug))
    .reduce((supporters, supporter) => {
      if (uniqueSupporters.has(supporter.slug)) {
        // aggregate donation totals
        uniqueSupporters.get(supporter.slug).totalDonations +=
          supporter.totalDonations;
        return supporters;
      }
      uniqueSupporters.set(supporter.slug, supporter);
      return [...supporters, supporter];
    }, [])
    .sort((a, b) => b.totalDonations - a.totalDonations)
    .reduce(
      (supporters, supporter) => {
        if (supporter.type === 'INDIVIDUAL') {
          if (supporter.name !== 'anonymous') {
            supporters.backers.push({
              ...supporter,
              avatar: supporter.imgUrlSmall
            });
          }
        } else {
          supporters.sponsors.push({...supporter, avatar: supporter.imgUrlMed});
        }
        return supporters;
      },
      {sponsors: [], backers: []}
    );

  const supporterImagePath = resolve(__dirname, '../images/supporters');

  mkdirSync(supporterImagePath, {recursive: true});

  // Fetch images for sponsors and save their image dimensions
  await Promise.all(
    supporters.sponsors.map(async sponsor => {
      const filePath = resolve(supporterImagePath, sponsor.id + '.png');
      const {body} = await needle('get', encodeURI(sponsor.avatar));

      let imageBuffer = body;

      // Some times OpenCollective responds with a non-image
      if ((await fileType.fromBuffer(body)).mime === 'image/png') {
        sponsor.dimensions = imageSize(body);
      } else {
        sponsor.dimensions = {width: 64, height: 64};
        imageBuffer = blank64;
      }

      await writeFile(filePath, imageBuffer);
    })
  );

  // Fetch images for backers and save their image dimensions
  await Promise.all(
    supporters.backers.map(async backer => {
      const filePath = resolve(supporterImagePath, backer.id + '.png');
      const {body} = await needle('get', encodeURI(backer.avatar));

      let imageBuffer = body;

      // Some times OpenCollective responds with a non-image
      if ((await fileType.fromBuffer(body)).mime !== 'image/png') {
        imageBuffer = blank32;
      }

      await writeFile(filePath, imageBuffer);
    })
  );

  debug(
    'found %d valid backers and %d valid sponsors (%d total)',
    supporters.backers.length,
    supporters.sponsors.length,
    supporters.backers.length + supporters.sponsors.length
  );
  return supporters;
};
