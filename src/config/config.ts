
export default () => ({ 
    port: parseInt(process.env.PORT  || "3000", 10),
    jwt_secret: process.env.JWT_SECRET,
    refresh_secret: process.env.REFRESH_SECRET
  });
  