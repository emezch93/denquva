/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: '#16241D',
        paper: '#FAF7F1',
        surface: '#FFFFFF',
        primary: { DEFAULT: '#0F6B4C', dark: '#0B5038', light: '#E4F1EA' },
        amber: { DEFAULT: '#E2932E', dark: '#B9721B', light: '#FBEBD3' },
        danger: { DEFAULT: '#C1443C', light: '#F8E2DF' },
      },
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
    },
  },
};
