const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  firstname: {
    type: String,
    required: true
  },
  lastname: {
    type: String,
    required: true
  },
  thumbnail: {
    type: String
  },
  birthdate: {
    type: Date,
    required: true
  },
  rating: {
    type: Number,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now()
  },
  updatedAt: {
    type: Date,
    default: Date.now()
  }
});

module.exports = mongoose.model('User', UserSchema, 'users');
